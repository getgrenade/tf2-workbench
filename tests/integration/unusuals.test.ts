// npx esbuild tests/integration/unusuals.test.ts --bundle --platform=node --format=esm --outfile=target/unusuals.test.mjs
// node --test target/unusuals.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { parsePcf, particleDefinitions, type ParticleDefinition } from "../../src/viewer/particles/pcf";
import { parseSheet, parseParticleModel, parseUnusualSettings, blankUnusuals, particleAdditive, particleMaterialSettings, particleBaseImage, particleSystemForTeam, UNUSUALS } from "../../src/viewer/particles/assets";
import { ParticleRopeDraw } from "../../src/viewer/particles/rope";
import { Actor, type ActorContext } from "../../src/viewer/actor";
import { GeometryCache } from "../../src/viewer/geometryCache";
import type { ModelData } from "../../src/viewer/payload";
import { ParticleSimulation, validateDefinitions, sourceOscillationWave, type ParticleQueries } from "../../src/viewer/particles/simulation";
import { ParticleDraw, sheetUv, sheetSample, spriteSheetTime, screenVelocityRoll, particleDepthPosition } from "../../src/viewer/particles/render";
import { parseScene } from "../../src/viewer/scene";
import { nativeControlPoint, NativeRenderNode } from "../../src/viewer/particles/native";
import { nativeHitboxes, hatControlPoint } from "../../src/viewer/particles/effects";

const op = (name: string, attributes = {}) => ({ type: "DmeParticleOperator", name, attributes: { functionName: name, ...attributes } });
const def = (name: string, max = 10): ParticleDefinition => ({ name, attributes: { max_particles: max }, functions: { emitters: [], initializers: [], operators: [], renderers: [], forces: [], constraints: [] }, children: [] });
const queries: ParticleQueries = {
  controlPoint: () => new THREE.Matrix4(), bone: () => new THREE.Matrix4(),
  sampleModel: () => ({ position: new THREE.Vector3(0, 0, 40), local: new THREE.Vector3(), bone: 0 }),
};

test("untextured UnlitGeneric particle materials use Source's standard white texture", () => {
  const data = { path: "materials/vgui/white.vmt", shader: "UnlitGeneric", params: {}, textures: {}, errors: [], proxies: [] };
  const white = particleBaseImage(data);
  assert.equal(white.width, 1); assert.equal(white.height, 1);
  assert.deepEqual([...white.rgba], [255, 255, 255, 255]);
  assert.throws(() => particleBaseImage({ ...data, params: { "$basetexture": "missing" } }), /missing texture/);
  assert.throws(() => particleBaseImage({ ...data, errors: ["Could not read VMT"] }), /Could not read VMT/);
  assert.throws(() => particleBaseImage({ ...data, shader: "Spritecard" }), /missing texture/);
});

test("legacy hat schemas follow the unusual anchor, not a retained pelvis root", () => {
  const head = new THREE.Matrix4().makeRotationY(.3).setPosition(10, 20, 70);
  const pelvis = new THREE.Matrix4().setPosition(10, 20, 35);
  const hat = { path: "hat.mdl", bones: [{ name: "bip_pelvis" }, { name: "bip_head" }] } as ModelData;
  const actor = { boneNames: ["bip_head"], particleBoneFrame: () => head,
    particleCosmeticBoneFrame: (_id: number, _path: string, bone: number) => bone === 1 ? head : pelvis,
    particleCosmeticRootFrame: () => pelvis } as unknown as Actor;
  const local = new THREE.Matrix4().setPosition(0, 0, 3);
  const model = { hitboxes: [], attachments: [{ name: "unusual", bone: 1, local }] };
  for (const attachment of ["", "muzzle"]) {
    // Bubbling #34 omits attachment; Burning Flames #13 names a missing muzzle.
    assert.deepEqual(hatControlPoint(actor, 42, hat, model, attachment, true).elements, head.clone().multiply(local).elements);
  }
  head.setPosition(30, 40, 80);
  assert.deepEqual(hatControlPoint(actor, 42, hat, model, "", true).elements, head.clone().multiply(local).elements);
  // A valid explicit attachment (including cosmetic-only bones) retains priority.
  model.attachments.push({ name: "muzzle", bone: 0, local: new THREE.Matrix4() });
  assert.deepEqual(hatControlPoint(actor, 42, hat, model, "muzzle", true).elements, pelvis.elements);
  assert.deepEqual(hatControlPoint(actor, 42, hat, { hitboxes: [], attachments: [] }, "", true).elements, head.elements);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(hatControlPoint(actor, null, null, null, "", true)).toArray(), [30, 40, 88]);
});

test("Arctic scalar yaw uses Source's waveform and native radian attribute units", () => {
  assert.equal(sourceOscillationWave(.25), .75);
  assert.equal(sourceOscillationWave(1.25), -.75);
  assert.equal(sourceOscillationWave(-.25), -.75);
  const d = def("yaw", 1);
  d.functions.emitters = [op("emit_instantaneously")];
  d.functions.operators = [op("Oscillate Scalar", { "oscillation field": 12,
    "oscillation rate min": 20, "oscillation rate max": 20,
    "oscillation frequency min": 0, "oscillation frequency max": 0,
    "oscillation start phase": .5, "proportional 0/1": true })];
  const sim = new ParticleSimulation(d, new Map([[d.name, d]]), queries);
  for (let tick = 0; tick < 30; tick++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.particles[0].yaw - 10) < 1e-9, "20 rad/s must give 10 radians after half a second");
  assert.equal(sim.particles[0].rotation, 0, "yaw must not change the sprite's roll");
  sim.particles[0].yaw = Math.PI / 2;
  sim.particles[0].rotation = .25;
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const draw = new ParticleDraw(sim, { texture, sheet: new Map(), additive: true });
  draw.update(new THREE.PerspectiveCamera());
  const appearance = draw.mesh.geometry.getAttribute("appearance");
  assert.ok(Math.abs(appearance.getY(0) - .25) < 1e-6);
  assert.ok(Math.abs(appearance.getZ(0) - Math.PI / 2) < 1e-6, "renderer must receive yaw independently, including the edge-on angle");
  draw.dispose(); texture.dispose();
});

test("Source movement damps at 30 Hz and adds Arctic twist acceleration after damping", () => {
  const d = def("arctic movement", 1);
  d.functions.emitters = [op("emit_instantaneously")];
  d.functions.initializers = [op("Position Within Box Random", { min: [10, 0, 0], max: [10, 0, 0] }),
    op("Velocity Random", { speed_in_local_coordinate_system_min: [10, 0, 0], speed_in_local_coordinate_system_max: [10, 0, 0] })];
  d.functions.operators = [op("Movement Basic", { drag: .35 })];
  d.functions.forces = [op("twist around axis", { "amount of force": 350, "twist axis": [0, 0, 1] })];
  const sim = new ParticleSimulation(d, new Map([[d.name, d]]), queries);
  const dt = 1 / 60, damping = Math.sqrt(.65);
  sim.step(dt);
  const p = sim.particles[0];
  assert.ok(Math.abs(p.position.x - (10 + 10 * damping * dt)) < 1e-9);
  assert.ok(Math.abs(p.position.y - 350 * dt * dt) < 1e-9);
  // A force-free particle retains only 65% of its speed after 1/30 second.
  d.functions.forces = [];
  sim.step(dt);
  assert.ok(Math.abs(p.velocity.x - 6.5) < 1e-9);
});

test("native control points use Source's forward/right/up convention and preserve attachment position", () => {
  const matrix = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(3, 4, 70);
  const cp = nativeControlPoint(matrix);
  const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6));
  near(cp.slice(0, 3), [0, 1, 0]);
  near(cp.slice(3, 6), [1, 0, 0]);
  near(cp.slice(6, 9), [0, 0, 1]);
  assert.deepEqual(cp.slice(9), [3, 4, 70]);
});

test("native model queries receive hitbox bounds and posed bone transforms in Source order", () => {
  const matrix = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(3, 4, 70);
  const actor = { particleBoneFrame: (bone: number) => bone === 7 ? matrix : null } as Actor;
  const boxes = nativeHitboxes(actor, { attachments: [], hitboxes: [{ bone: 7, min: new THREE.Vector3(-1, -2, -3), max: new THREE.Vector3(1, 2, 3) }] });
  assert.deepEqual(boxes[0].slice(0, 6), [-1, -2, -3, 1, 2, 3]);
  const near = [0, -1, 0, 3, 1, 0, 0, 4, 0, 0, 1, 70];
  boxes[0].slice(6).forEach((value, i) => assert.ok(Math.abs(value - near[i]) < 1e-6));
  assert.throws(() => nativeHitboxes(actor, { attachments: [], hitboxes: [{ bone: 8, min: new THREE.Vector3(), max: new THREE.Vector3() }] }), /bone missing/);
});

test("catalog effect IDs persist in scene settings while legacy scenes retain their effects", () => {
  const settings = { silver: false, arctic: false, hatItem: 42, hatEffect: 13, tauntEffect: 3002 };
  const scene = parseScene(JSON.stringify({ app: "tf2-workbench", version: 1, camera: { position: [1, 2, 3], target: [0, 0, 0] }, entities: [{ cls: "soldier", unusuals: settings }] }));
  assert.deepEqual(scene.entities[0].unusuals, settings);
  assert.deepEqual(parseUnusualSettings({ hatEffect: -1, tauntEffect: 1.5 }), blankUnusuals());
});

test("team-colored unusuals follow the character's team as TF2 does", () => {
  assert.equal(particleSystemForTeam("utaunt_firework_teamcolor_red", 1), "utaunt_firework_teamcolor_blue");
  assert.equal(particleSystemForTeam("utaunt_firework_teamcolor_blue", 0), "utaunt_firework_teamcolor_red");
  assert.equal(particleSystemForTeam("unusual_sheetmusic_silver_parent", 1), "unusual_sheetmusic_silver_parent");
});

test("sprite trails use native velocity and interpret max length zero as unlimited", () => {
  const d = def("trail"); d.functions.renderers = [op("render_sprite_trail", { "max length": 0 })];
  const node = new NativeRenderNode(d, 1);
  node.apply({ id: 0, name: "trail", capacity: 1, time: 1, particles: [[10, 0, 0, 1, 1, 1, 1, 2, 0, 0, 2, 0, 0, 9, 0, 0, .5]] });
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const draw = new ParticleDraw(node, { texture, sheet: new Map(), additive: true });
  draw.update(new THREE.PerspectiveCamera());
  assert.ok(Math.abs(draw.mesh.geometry.getAttribute("particleMotion").getX(0) - 30) < 1e-6);
  draw.dispose(); texture.dispose();
});

test("native render attributes keep Valve's angles, sequence, particle lifetime and fractional alpha", () => {
  const node = new NativeRenderNode(def("native"), 20);
  node.apply({ id: 0, name: "native", capacity: 20, time: 8, particles: [[1, 2, 70, .2, .4, .8, .25, 1.5, Math.PI, 7, 3, 6, .125]] });
  const p = node.particles[0];
  assert.deepEqual(p.position.toArray(), [1, 2, 70]);
  assert.deepEqual(p.color, [.2, .4, .8]);
  assert.equal(p.alpha, .25); assert.equal(p.radius, 1.5); assert.equal(p.rotation, Math.PI);
  assert.equal(node.time - p.born, 1); assert.equal(p.life, 3); assert.equal(p.sequence, 6); assert.equal(p.yaw, .125);
  node.apply({ id: 0, name: "native", capacity: 20, time: 9, particles: [] });
  assert.equal(node.particles.length, 0);
});

test("Sprite beam material uses its Source additive render mode", () => {
  assert.equal(particleAdditive({ "$spriterendermode": "5" }), true);
  assert.equal(particleAdditive({ "$spriterendermode": "2" }), false);
  assert.equal(particleAdditive({ "$additive": "1" }), true);
});

test("box placement keeps world-up offsets on rotated hat control points unless local space is enabled", () => {
  for (const local of [false, true]) {
    const d = def("box", 1);
    d.functions.emitters = [op("emit_instantaneously")];
    d.functions.initializers = [op("Position Within Box Random", { min: [0, 0, 6], max: [0, 0, 6], "use local space": local })];
    const cp = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(10, 20, 60);
    const sim = new ParticleSimulation(d, new Map([[d.name, d]]), { ...queries, controlPoint: () => cp });
    sim.step(1 / 60);
    assert.ok(sim.particles[0].position.distanceTo(new THREE.Vector3(...(local ? [10, 14, 60] : [10, 20, 66]) as [number, number, number])) < 1e-6);
  }
});

test("rope subdivision joins vertices and interpolates width/alpha without segment seams", () => {
  const d = def("rope", 4);
  d.functions.emitters = [op("emit_instantaneously", { num_to_emit: 4 })];
  d.functions.renderers = [op("render_rope", { subdivision_count: 3, texel_size: 4 })];
  const sim = new ParticleSimulation(d, new Map([[d.name, d]]), queries);
  sim.step(1 / 60);
  sim.particles.forEach((p, i) => { p.position.set(i * 2, i % 2, 0); p.alpha = i / 3; p.radius = 0.5 + i / 4; });
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const draw = new ParticleRopeDraw(sim, { texture, sheet: new Map(), additive: true });
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 0, 20); camera.updateMatrixWorld();
  draw.update(camera);
  assert.equal(draw.geometry.drawRange.count, 9 * 6);
  const position = draw.geometry.getAttribute("position"), color = draw.geometry.getAttribute("ribbonColor"), uv = draw.geometry.getAttribute("uv");
  assert.ok(Array.from(position.array).every(Number.isFinite));
  const center = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i * 2).add(new THREE.Vector3().fromBufferAttribute(position, i * 2 + 1)).multiplyScalar(0.5);
  assert.ok(center(3).distanceTo(sim.particles[1].position) < 1e-6);
  assert.ok(center(9).distanceTo(sim.particles[3].position) < 1e-6);
  const left = new THREE.Vector3().fromBufferAttribute(position, 6);
  const right = new THREE.Vector3().fromBufferAttribute(position, 7);
  assert.ok(Math.abs(left.distanceTo(right) - sim.particles[1].radius) < 1e-6,
    "Source rope radius specifies the full strip width, not its half-width");
  assert.ok(Math.abs(color.getW(6) - 1 / 3) < 1e-6);
  assert.equal(uv.getY(4), uv.getY(5));
  const indices = Array.from(draw.geometry.index!.array.slice(0, 12));
  assert.deepEqual(indices, [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
  assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
  sim.particles.length = 1; draw.update(camera); assert.equal(draw.geometry.drawRange.count, 0);
  draw.dispose(); texture.dispose();
});

test("cosmetic-only attachment bones follow the actual merged and posed hat skeleton", () => {
  const actor = new Actor(1, { scene: new THREE.Scene(), geometry: new GeometryCache(), jiggle: () => false, mats: {} as ActorContext["mats"] });
  const head = { name: "bip_head", parent: -1, poseToBone: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -60] };
  const model: ModelData = { path: "models/player/test.mdl", flexDescCount: 0, flexControllers: [], flexRules: [], skinCount: 2, eyeAttachment: null, includeModels: [], bodyParts: [], bones: [head] };
  const hat = { ...model, path: "models/test_hat.mdl", bones: [head, { name: "hat_extra", parent: 0, poseToBone: [1, 0, 0, -3, 0, 1, 0, 0, 0, 0, 1, -65] }] };
  actor.setModel(model, new Map()); actor.setCosmetics([{ data: hat, itemId: 42, paint: null, skin: 0 }]);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(actor.particleCosmeticRootFrame(42, hat.path)!).toArray(), [0, 0, 60]);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(actor.particleCosmeticBoneFrame(42, hat.path, 1)!).toArray(), [3, 0, 65]);
  actor.usePose(actor.bindPose()!); actor.setBonePos(0, 10, 20, 70); actor.updateCosmetics();
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(actor.particleCosmeticBoneFrame(42, hat.path, 1)!).toArray(), [13, 20, 75]);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(actor.particleCosmeticRootFrame(42, hat.path)!).toArray(), [10, 20, 70]);
  actor.setCosmetics([]); assert.equal(actor.particleCosmeticBoneFrame(42, hat.path, 1), null); actor.dispose();
});

test("emission is bounded, delayed bursts fire once, and particles decay", () => {
  const d = def("test", 4);
  d.functions.emitters = [op("emit_instantaneously", { emission_start_time: 0.5, num_to_emit: 4 })];
  d.functions.initializers = [op("Lifetime Random", { lifetime_min: 0.2, lifetime_max: 0.2 })];
  d.functions.operators = [op("Lifespan Decay")];
  const sim = new ParticleSimulation(d, new Map([[d.name, d]]), queries);
  for (let i = 0; i < 29; i++) sim.step(1 / 60);
  assert.equal(sim.particles.length, 0);
  for (let i = 0; i < 3; i++) sim.step(1 / 60);
  assert.equal(sim.particles.length, 4);
  for (let i = 0; i < 60; i++) sim.step(1 / 60);
  assert.equal(sim.particles.length, 0);
});

test("repeated children remain separate instances with their own parent positions", () => {
  const root = def("root", 1), a = def("a", 1), b = def("b", 1), rope = def("rope", 3);
  root.children = [{ name: "a", delay: 0 }, { name: "b", delay: 0 }];
  for (const [d, x] of [[a, 10], [b, 20]] as const) {
    d.functions.emitters = [op("emit_continuously", { emission_rate: 60 })];
    d.functions.initializers = [op("Position Within Box Random", { min: [x, 0, 0], max: [x, 0, 0] })];
    d.children = [{ name: "rope", delay: 0 }];
  }
  rope.functions.emitters = [op("emit_continuously", { emission_rate: 60 })];
  rope.functions.initializers = [op("Position From Parent Particles")];
  const defs = new Map([root, a, b, rope].map((d) => [d.name, d]));
  validateDefinitions(defs, "root");
  const sim = new ParticleSimulation(root, defs, queries);
  sim.step(1 / 60);
  assert.equal(sim.children[0].children[0].particles[0].position.x, 10);
  assert.equal(sim.children[1].children[0].particles[0].position.x, 20);
  assert.notEqual(sim.children[0].children[0], sim.children[1].children[0]);
});

test("unsupported operators and cyclic particle graphs fail explicitly", () => {
  const d = def("test"); d.functions.operators = [op("unknown")];
  assert.throws(() => validateDefinitions(new Map([[d.name, d]]), d.name), /Unsupported/);
  d.functions.operators = []; d.children = [{ name: d.name, delay: 0 }];
  assert.throws(() => validateDefinitions(new Map([[d.name, d]]), d.name), /Cyclic/);
});

test("sprite sequences loop or clamp by individual frame duration", () => {
  const frames = [{ duration: 0.25, uv: [0, 0, 0.5, 1] }, { duration: 0.75, uv: [0.5, 0, 1, 1] }];
  assert.deepEqual(sheetUv({ frames, duration: 1, clamp: false }, 1.1), frames[0].uv);
  assert.deepEqual(sheetUv({ frames, duration: 1, clamp: true }, 2), frames[1].uv);
  assert.deepEqual(sheetSample({ frames, duration: 1, clamp: false }, .125), { uv: frames[0].uv, next: frames[1].uv, blend: .5 });
  const loop = sheetSample({ frames, duration: 1, clamp: false }, .625);
  assert.deepEqual(loop.next, frames[0].uv); assert.equal(loop.blend, .5);
  assert.deepEqual(sheetSample({ frames, duration: 1, clamp: true }, 2).next, frames[1].uv);
});

test("unusual settings survive scene serialization and invalid selections are neutral", () => {
  assert.deepEqual(parseUnusualSettings({ silver: "yes", arctic: true, hatItem: 1.2 }), { silver: false, arctic: true, hatItem: null });
  const settings = { silver: true, arctic: true, hatItem: 42 };
  const scene = parseScene(JSON.stringify({ app: "tf2-workbench", version: 1, camera: { position: [1, 2, 3], target: [0, 0, 0] }, entities: [{ cls: "soldier", unusuals: settings }] }));
  assert.deepEqual(scene.entities[0].unusuals, settings);
});

test("malformed PCF data is rejected", () => {
  assert.throws(() => parsePcf(new ArrayBuffer(0)), /Truncated/);
  const header = new TextEncoder().encode("<!-- dmx encoding binary 2 format pcf 1 -->\n\0");
  assert.throws(() => parsePcf(header.buffer), /bounds|Truncated/);
});

// Independent test VPK reader: original game assets stay outside the repository.
function installedAssets(folder: string, packs = ["tf2_misc_dir.vpk", "tf2_textures_dir.vpk"]) {
  const entries = new Map<string, { file: string; offset: number; size: number; preload: Buffer }>();
  for (const filename of packs) {
    const full = path.join(folder, filename), buffer = fs.readFileSync(full);
    const header = buffer.readUInt32LE(4) === 2 ? 28 : 12, dataStart = header + buffer.readUInt32LE(8);
    let at = header;
    const string = () => { const end = buffer.indexOf(0, at); const text = buffer.toString("utf8", at, end); at = end + 1; return text; };
    for (let ext; (ext = string());) for (let dir; (dir = string());) for (let name; (name = string());) {
      const preloadSize = buffer.readUInt16LE(at + 4), archive = buffer.readUInt16LE(at + 6), offset = buffer.readUInt32LE(at + 8), size = buffer.readUInt32LE(at + 12); at += 18;
      const preload = buffer.subarray(at, at + preloadSize); at += preloadSize;
      entries.set(`${dir}/${name}.${ext}`, { file: archive === 32767 ? full : full.replace("_dir.vpk", `_${String(archive).padStart(3, "0")}.vpk`), offset: offset + (archive === 32767 ? dataStart : 0), size, preload });
    }
  }
  return (key: string): ArrayBuffer => {
    const e = entries.get(key); assert.ok(e, `Missing test asset ${key}`);
    const fd = fs.openSync(e.file, "r"), bytes = Buffer.alloc(e.size);
    try { fs.readSync(fd, bytes, 0, bytes.length, e.offset); } finally { fs.closeSync(fd); }
    const buffer = Buffer.concat([e.preload, bytes]);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  };
}
const tfDir = process.env.TF_DIR;
test("both installed Searing Stove graphs accept their untextured white driver material", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const definitions = particleDefinitions(parsePcf(read("particles/halloween2024_unusuals.pcf")));
  const hl2 = installedAssets(path.join(tfDir!, "../hl2"), ["hl2_misc_dir.vpk"]);
  const vmt = new TextDecoder().decode(hl2("materials/vgui/white.vmt"));
  assert.match(vmt, /"UnlitGeneric"/i);
  assert.doesNotMatch(vmt, /\$basetexture/i);
  for (const [root, point] of [["unusual_stove_teamcolor_red", "unusual_stove_flame_point_red"], ["unusual_stove_teamcolor_blue", "unusual_stove_flame_point"]]) {
    assert.ok(definitions.get(root)!.children.some((child) => child.name === point));
    const driver = definitions.get(point)!;
    assert.equal(driver.attributes.material, "vgui/white");
    assert.ok(driver.functions.renderers.length, "Driver material must pass through the renderer loader");
    assert.ok(driver.children.length >= 8, "Rejecting this material would lose all flame children");
    assert.equal(particleBaseImage({ path: "materials/vgui/white.vmt", shader: "UnlitGeneric", params: {}, textures: {}, proxies: [], errors: [] }).rgba[3], 255);
  }
});
test("Sulfuric Acid material features retain soft depth and spark self-illumination", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const params = (path: string) => Object.fromEntries([...new TextDecoder().decode(read(path))
    .replace(/\/\/[^\n]*/g, "").matchAll(/"?([\w?$]+)"?\s+"?([-\d.]+)"?/g)].map((m) => [m[1].toLowerCase(), m[2]]));
  const flame = particleMaterialSettings("Spritecard", params("materials/particle/flamethrowerfire/flamethrowerfire102.vmt"));
  assert.equal(flame.overbright, 5, "sRGB conditional overrides the default spark brightness");
  assert.equal(flame.addSelf, .5);
  assert.equal(flame.depthBlend, true);
  assert.equal(flame.depthBlendScale, 100);
  const fog = particleMaterialSettings("SpriteCard", params("materials/effects/smoke/smokelit_nofade_add.vmt"));
  assert.equal(fog.depthBlend, true, "Source defaults soft depth on when SpriteCard omits $depthblend");
  assert.equal(fog.depthBlendScale, 50);
  assert.equal(particleMaterialSettings("SpriteCard", { "$depthblend": "0" }).depthBlend, false);
  assert.equal(particleMaterialSettings("UnlitGeneric", { "$additive": "1" }).depthBlend, false);
  const node = new NativeRenderNode(def("depth"), 1);
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const draw = new ParticleDraw(node, { texture, sheet: new Map(), ...flame });
  const depth = new THREE.DepthTexture(64, 32), camera = new THREE.PerspectiveCamera(50, 2, 1, 5000);
  draw.setSceneDepth(depth, camera, 64, 32);
  const material = draw.mesh.material as THREE.ShaderMaterial;
  assert.equal(material.uniforms.depthEnabled.value, 1);
  assert.equal(material.uniforms.addSelf.value, .5);
  assert.equal(material.uniforms.overbright.value, 5);
  assert.deepEqual(material.uniforms.depthSize.value.toArray(), [64, 32]);
  assert.deepEqual(material.uniforms.inverseProjection.value.elements, camera.projectionMatrixInverse.elements);
  assert.equal(material.premultipliedAlpha, true);
  draw.setSceneDepth(null, camera, 1, 1);
  assert.equal(material.uniforms.depthEnabled.value, 0);
  draw.dispose(); texture.dispose(); depth.dispose();
});
test("Radioactive floor glow uses the authored horizontal plane, overriding material defaults", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const defs = particleDefinitions(parsePcf(read("particles/halloween2026_unusuals.pcf")));
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  for (const variant of ["tcred", "tcblue", "green", "purple"]) {
    const d = defs.get(`utaunt_radioactive_${variant}_floor`)!;
    assert.ok(d);
    assert.equal(d.functions.renderers[0].attributes.orientation_type, 2);
    const node = new NativeRenderNode(d, 1);
    node.apply({ id: 0, name: d.name, capacity: 1, time: 1, particles: [[0, 0, .5, 1, 1, 1, 1, 100, 0, 0, 2, 0, 0]] });
    // loadParticleMaterial supplies orientation 0 when the VMT omits $orientation.
    const draw = new ParticleDraw(node, { texture, sheet: new Map(), additive: true, orientation: 0 });
    draw.update(new THREE.PerspectiveCamera());
    assert.equal((draw.mesh.material as THREE.ShaderMaterial).uniforms.orientation.value, 2,
      "100-unit floor card must remain horizontal instead of covering the character");
    assert.equal(draw.mesh.geometry.getAttribute("particlePosition").getZ(0), .5);
    draw.dispose();
  }
  const upright = def("upright"); upright.functions.renderers = [op("render_animated_sprites", { orientation_type: 1 })];
  const draw = new ParticleDraw(new NativeRenderNode(upright, 1), { texture, sheet: new Map(), additive: true, orientation: 0 });
  assert.equal((draw.mesh.material as THREE.ShaderMaterial).uniforms.orientation.value, 1);
  draw.dispose(); texture.dispose();
});
test("Gamma Rays and Radioactive push their ring and smoke behind the character depth", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const defs = particleDefinitions(parsePcf(read("particles/halloween2026_unusuals.pcf")));
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  for (const variant of ["tcred", "tcblue", "green", "purple"]) for (const part of ["glow", "smoke1"]) {
    const d = defs.get(`utaunt_radioactive_${variant}_${part}`)!;
    assert.ok(d);
    assert.equal(d.functions.renderers[0].attributes["Visibility Camera Depth Bias"], -7);
    const node = new NativeRenderNode(d, 1);
    // A sprite born in front of a character surface at view Z=-12 should render behind it.
    node.apply({ id: 0, name: d.name, capacity: 1, time: 1, particles: [[0, 0, -10, 1, 1, 1, 1, 2, 0, 0, 2, 0, 0]] });
    const draw = new ParticleDraw(node, { texture, sheet: new Map(), additive: part === "glow" });
    draw.update(new THREE.PerspectiveCamera());
    const position = draw.mesh.geometry.getAttribute("particlePosition");
    assert.equal(position.getZ(0), -17, "negative bias lets existing depth testing occlude the card");
    assert.equal(node.particles[0].position.z, -10, "bias must not change native motion or emission");
    const material = draw.mesh.material as THREE.ShaderMaterial;
    assert.equal(material.depthTest, true);
    assert.equal(material.depthWrite, false);
    draw.dispose();
  }
  texture.dispose();
});

test("camera depth bias follows the eye ray and preserves neutral sprite placement", () => {
  const position = new THREE.Vector3(3, 4, 0), eye = new THREE.Vector3(), out = new THREE.Vector3();
  assert.deepEqual(particleDepthPosition(position, eye, -5, out).toArray(), [6, 8, 0]);
  assert.deepEqual(particleDepthPosition(position, eye, 5, out).toArray(), [0, 0, 0]);
  assert.deepEqual(particleDepthPosition(position, eye, 0, out).toArray(), position.toArray());
  assert.deepEqual(particleDepthPosition(eye, eye, -7, out).toArray(), eye.toArray());
});
test("installed Shroud crows animate across their sheet and inherit screen velocity roll", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const defs = particleDefinitions(parsePcf(read("particles/halloween2026_unusuals.pcf")));
  const d = defs.get("utaunt_shroud_crow_hold")!;
  assert.ok(d);
  const renderer = d.functions.renderers[0].attributes;
  assert.equal(d.functions.renderers[1].attributes.functionName, "render_screen_velocity_rotate");
  assert.equal(d.functions.renderers[1].attributes.forward_angle, -90);
  const sheet = parseSheet(read("materials/effects/workshop/crow.vtf"));
  const sequence = sheet.get(0)!;
  assert.equal(sequence.frames.length, 63);
  const node = new NativeRenderNode(d, 1);
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const draw = new ParticleDraw(node, { texture, sheet, additive: false, blendFrames: false });
  const camera = new THREE.PerspectiveCamera();
  const frame = (time: number) => node.apply({ id: 0, name: d.name, capacity: 1, time,
    particles: [[1, 1, -10, 1, 1, 1, 1, 7, 0, 0, 2, 0, 0, 0, 0, -10, 1]] });
  frame(.25); draw.update(camera);
  const uv = draw.mesh.geometry.getAttribute("sheetRect");
  const first = [uv.getX(0), uv.getY(0), uv.getZ(0), uv.getW(0)];
  frame(1); draw.update(camera);
  assert.notDeepEqual([uv.getX(0), uv.getY(0), uv.getZ(0), uv.getW(0)], first, "wing frames must change within the crow's two-second lifetime");
  assert.ok(Math.abs(spriteSheetTime(sequence, 1, 2, renderer) - sequence.duration / 2) < 1e-4);
  const appearance = draw.mesh.geometry.getAttribute("appearance");
  assert.ok(Math.abs(appearance.getY(0) + Math.PI / 4) < 1e-6, "diagonal velocity uses the authored -90 degree offset");
  camera.rotation.z = Math.PI / 2; draw.update(camera);
  assert.ok(Math.abs(appearance.getY(0) + 3 * Math.PI / 4) < 1e-6, "roll must follow the current camera basis");
  assert.equal(draw.mesh.geometry.getAttribute("particleMotion").getW(0), 0, "crow material disables frame blending");
  draw.dispose(); texture.dispose();
});

test("installed Thundering Spirit arcs retain legacy Sprite material defaults", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const defs = particleDefinitions(parsePcf(read("particles/halloween2021_unusuals.pcf")));
  assert.ok(defs.get("utaunt_elebound_purple_parent"));
  const vmt = new TextDecoder().decode(read("materials/effects/electro_beam.vmt")).replace(/\/\/[^\n]*/g, "");
  const params = Object.fromEntries([...vmt.matchAll(/"?(\$[\w]+)"?\s+"?([-\d.]+)"?/g)].map((m) => [m[1].toLowerCase(), m[2]]));
  const settings = particleMaterialSettings("Sprite", params);
  assert.equal(settings.additive, true);
  assert.equal(settings.srgb, false, "Sprite_DX9 defaults to raw texture reads");
  assert.equal(settings.vertexColor, true, "the game tints legacy Sprite beams with the particle colour (the SDK's IGNOREVERTEXCOLORS default would leave them white)");
  assert.equal(settings.vertexAlpha, true, "and fades them with the particle alpha");
  assert.equal(settings.overbright, 1, "Sprite supports HDRCOLORSCALE, not the unused OVERBRIGHTFACTOR 15");
  const explicit = particleMaterialSettings("Sprite_DX9", { "$nosrgb": "0", "$ignorevertexcolors": "0", "$hdrcolorscale": "2" });
  assert.equal(explicit.srgb, true); assert.equal(explicit.vertexColor, true); assert.equal(explicit.vertexAlpha, true);
  assert.equal(explicit.overbright, 2);
  const ignored = particleMaterialSettings("Sprite", { "$ignorevertexcolors": "1" });
  assert.equal(ignored.vertexColor, false, "a material can still ask for its vertex colours to be ignored");
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  for (const name of ["utaunt_elebound_purple_trail1", "utaunt_elebound_purple_trail2"]) {
    const d = defs.get(name)!;
    assert.equal(String(d.attributes.material).replaceAll("\\", "/"), "effects/electro_beam.vmt");
    const draw = new ParticleRopeDraw(new NativeRenderNode(d, 45), { texture, sheet: new Map(), ...settings });
    const uniforms = (draw.mesh.material as THREE.ShaderMaterial).uniforms;
    assert.equal(uniforms.vertexColor.value, 1); assert.equal(uniforms.vertexAlpha.value, 1);
    assert.equal(uniforms.overbright.value, 1);
    draw.dispose();
  }
  texture.dispose();
});

test("installed Infernal Wraith, Phantom Crown and Ancient Specter scroll in Source distance units", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const defs = particleDefinitions(parsePcf(read("particles/halloween2021_unusuals.pcf")));
  const bytes = new DataView(read("materials/effects/workshop/spirit_trail.vtf"));
  const width = bytes.getUint16(16, true), height = bytes.getUint16(18, true);
  assert.equal(height, 256);
  const texture = new THREE.DataTexture(new Uint8Array(width * height * 4).fill(255), width, height);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 0, 20); camera.updateMatrixWorld();
  for (const color of ["green", "purple", "yellow"]) {
    const root = defs.get(`unusual_phantomcrown_${color}_parent`)!;
    const name = `unusual_phantomcrown_${color}_trail1`;
    const reachable = new Set<string>();
    const walk = (system: string) => {
      if (reachable.has(system)) return;
      reachable.add(system);
      for (const child of defs.get(system)?.children ?? []) walk(child.name);
    };
    walk(root.name);
    assert.ok(reachable.has(name));
    const d = defs.get(name)!;
    assert.equal(d.functions.renderers[0].attributes.texture_scroll_rate, 25);
    const node = new NativeRenderNode(d, 2);
    const frame = (time: number) => node.apply({ id: 0, name, capacity: 2, time,
      particles: [0, 10].map((x) => [x, 0, 0, 1, 1, 1, 1, 2, 0, 0, 10, 0, 0]) });
    const draw = new ParticleRopeDraw(node, { texture, sheet: new Map(), additive: true });
    const uv = draw.geometry.getAttribute("uv");
    frame(0); draw.update(camera);
    const end = uv.getY(uv.count - 1);
    // One 256-texel repeat spans 15.36 world units: 25 units/s gives a 0.6144-second cycle.
    frame(1 / 60); draw.update(camera);
    assert.ok(Math.abs(uv.getY(0) - 25 / (60 * .06 * 256)) < 1e-7, color);
    frame(.6144); draw.update(camera);
    assert.ok(Math.abs(uv.getY(0) - 1) < 1e-6, color);
    assert.ok(Math.abs(uv.getY(uv.count - 1) - end - 1) < 1e-6, "scroll must preserve spatial tiling");
    draw.dispose();
  }
  texture.dispose();
});

test("sprite FPS and lifetime modes retain their authored timing", () => {
  const sequence = { duration: 2, clamp: false, frames: [{ duration: .5, uv: [0, 0, .5, 1] }, { duration: 1.5, uv: [.5, 0, 1, 1] }] };
  assert.equal(spriteSheetTime(sequence, .25, 4, { "animation rate": 4, "use animation rate as FPS": true }), 1);
  assert.equal(spriteSheetTime(sequence, 1, 4, { "animation rate": .5 }), 1);
  assert.equal(spriteSheetTime(sequence, 1, 4, { animation_fit_lifetime: true, "animation rate": 30 }), .5);
  assert.equal(screenVelocityRoll(new THREE.Vector3(0, 1, 0), -90), 0);
});
test("installed modern hat anchors legacy Bubbling and Burning Flames at its head", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  const path = "models/workshop/player/items/heavy/hwn2026_damage_dealer/hwn2026_damage_dealer.mdl";
  const bytes = read(path), view = new DataView(bytes), raw = new Uint8Array(bytes);
  const bones = Array.from({ length: view.getInt32(156, true) }, (_, i) => {
    const at = view.getInt32(160, true) + i * 216, nameAt = at + view.getInt32(at, true);
    return { name: new TextDecoder().decode(raw.subarray(nameAt, raw.indexOf(0, nameAt))) };
  });
  assert.equal(bones[0].name, "bip_pelvis", "fixture must reproduce a retained parent chain");
  const head = new THREE.Matrix4().setPosition(0, 0, 70), pelvis = new THREE.Matrix4().setPosition(0, 0, 35);
  const actor = { boneNames: ["bip_head"], particleBoneFrame: () => head,
    particleCosmeticBoneFrame: (_id: number, _path: string, bone: number) => bones[bone].name === "bip_head" ? head : pelvis,
    particleCosmeticRootFrame: () => pelvis } as unknown as Actor;
  const hat = { path, bones } as ModelData;
  const model = parseParticleModel(bytes);
  for (const attachment of ["", "muzzle", "unusual"]) {
    assert.equal(new THREE.Vector3().setFromMatrixPosition(hatControlPoint(actor, 31639, hat, model, attachment, true)).z, 70);
  }
});
test("both installed effect graphs parse and simulate all children with finite bounded particles", { skip: !tfDir }, () => {
  const read = installedAssets(tfDir!);
  for (const id of ["silver", "arctic"] as const) {
    const config = UNUSUALS[id], defs = particleDefinitions(parsePcf(read(config.file)));
    const names = validateDefinitions(defs, config.system);
    assert.equal(names.size, id === "silver" ? 32 : 5);
    const first = new ParticleSimulation(defs.get(config.system)!, defs, queries, 123);
    const repeat = new ParticleSimulation(defs.get(config.system)!, defs, queries, 123);
    for (let tick = 0; tick < 720; tick++) { first.step(1 / 60); repeat.step(1 / 60); }
    assert.ok(first.walk().some((s) => s.particles.length));
    for (const [i, node] of first.walk().entries()) {
      assert.ok(node.particles.length <= node.capacity, node.definition.name);
      for (const p of node.particles) assert.ok([...p.position.toArray(), p.radius, p.alpha, p.rotation].every(Number.isFinite), node.definition.name);
      assert.deepEqual(node.particles.map((p) => p.position.toArray()), repeat.walk()[i].particles.map((p) => p.position.toArray()));
    }
  }
  const model = parseParticleModel(read("models/player/soldier.mdl"));
  assert.ok(model.hitboxes.length > 10);
  assert.ok(model.attachments.some((a) => a.name === "eyes"));
  const sheet = parseSheet(read("materials/effects/workshop/unusual_sheetmusic/moregun.vtf"));
  assert.equal(sheet.size, 7);
  assert.equal(sheet.get(6)!.frames.length, 1);
});

test("a Refract material is drawn from its normal map, with its amount and tint", () => {
  const settings = particleMaterialSettings("Refract", { "$refractamount": "-3.0", "$vertexcolormodulate": "1", "$refracttint": "{205 225 255}", "$additive": "1", "$blendframes": "1" });
  assert.deepEqual(settings.refract, { amount: -3, tint: [205 / 255, 225 / 255, 1] });
  assert.equal(settings.srgb, false, "a normal map is read raw");
  assert.equal(settings.additive, true);
  assert.equal(settings.depthBlend, false);
  assert.equal(particleMaterialSettings("Refract", {}).refract?.amount, 2, "Source's default amount");
  assert.deepEqual(particleMaterialSettings("Refract", {}).refract?.tint, [1, 1, 1]);
  assert.equal(particleMaterialSettings("SpriteCard", {}).refract, undefined);
  const normal = { width: 2, height: 2, rgba: new Uint8Array(16).fill(128) };
  assert.equal(particleBaseImage({ path: "materials/x.vmt", shader: "Refract", params: {}, textures: { bump: normal }, proxies: [], errors: [] }), normal);
  assert.throws(() => particleBaseImage({ path: "materials/x.vmt", shader: "Refract", params: {}, textures: {}, proxies: [], errors: [] }), /missing texture/);
});
