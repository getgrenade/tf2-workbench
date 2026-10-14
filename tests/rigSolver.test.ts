// The rig solver against Blender: `scripts/rig/oracle.py` poses a rig in Blender and writes every bone's matrix; the solver has to land on the same ones.
// The files are not part of the repository (a rig is somebody's work). Put `<name>.rig.json` and `<name>.oracle.json` in a folder and point
// RIG_TEST_DIR at it (default: `rigs/` in the repository); without them this test does nothing.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as THREE from "three";
import { parseRig } from "../src/rig/rigData.ts";
import { RigSolver, matrixToEuler, eulerToMatrix } from "../src/rig/rigSolver.ts";

const dir = process.env.RIG_TEST_DIR ?? join(process.cwd(), "rigs");

test("Euler angles go both ways in every order", () => {
  for (const order of ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"]) {
    for (let n = 0; n < 40; n++) {
      const e: [number, number, number] = [Math.sin(n * 1.7) * 3, Math.sin(n * 2.3 + 1) * 1.4, Math.sin(n * 0.9 + 2) * 3];
      const m = eulerToMatrix(e, order);
      const back = matrixToEuler(m, order);
      const again = eulerToMatrix(back, order);
      for (let k = 0; k < 16; k++) assert.ok(Math.abs(m.elements[k] - again.elements[k]) < 1e-9, `${order} ${n}`);
    }
  }
  // Blender's XYZ is Rz * Ry * Rx
  const m = eulerToMatrix([0.3, 0, 0], "XYZ");
  assert.ok(Math.abs(m.elements[5] - Math.cos(0.3)) < 1e-9 && Math.abs(m.elements[6] - Math.sin(0.3)) < 1e-9);
});

function compareAll(name: string) {
  const rig = parseRig(readFileSync(join(dir, `${name}.rig.json`), "utf8"));
  const oracle = JSON.parse(readFileSync(join(dir, `${name}.oracle.json`), "utf8")) as { cases: { label: string; props: Record<string, Record<string, number>>; channels: Record<string, { loc?: number[]; rot?: number[]; scale?: number[] }>; matrices: Record<string, number[]> }[] };
  const solver = new RigSolver(rig);
  const report: string[] = [];
  let worst = 0;
  const gross: string[] = [];
  const only = process.env.RIG_CASE;
  for (const c of oracle.cases) {
    if (only && !c.label.includes(only)) continue;
    solver.resetChannels();
    for (const [bone, props] of Object.entries(rig.bones.reduce((a, b) => (Object.keys(b.props).length ? { ...a, [b.name]: b.props } : a), {} as Record<string, Record<string, unknown>>))) {
      for (const [key, slider] of Object.entries(props as Record<string, { value: number | boolean; default?: unknown }>)) solver.setSlider(bone, key, typeof slider.value === "boolean" ? Number(slider.value) : slider.value);
    }
    for (const [bone, props] of Object.entries(c.props)) for (const [key, value] of Object.entries(props)) solver.setSlider(bone, key, value);
    for (const [bone, ch] of Object.entries(c.channels)) solver.setChannels(bone, ch);
    solver.evaluate();
    const errs: { bone: string; pos: number; rot: number }[] = [];
    for (const bone of solver.names) {
      const want = c.matrices[bone];
      if (!want) continue;
      const got = solver.pose[solver.indexOf(bone)];
      const w = new THREE.Matrix4().fromArray(want);
      const pos = Math.hypot(got.elements[12] - w.elements[12], got.elements[13] - w.elements[13], got.elements[14] - w.elements[14]);
      // the rotation difference between the two, from the Y and Z axes (scale does not count here)
      const axes = [4, 8].map((o) => {
        const a = new THREE.Vector3(got.elements[o], got.elements[o + 1], got.elements[o + 2]).normalize();
        const b = new THREE.Vector3(w.elements[o], w.elements[o + 1], w.elements[o + 2]).normalize();
        return Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
      });
      errs.push({ bone, pos, rot: Math.max(...axes) });
    }
    if (process.env.RIG_JOINTS) for (const bone of process.env.RIG_JOINTS.split(",")) {
      const mine = solver.jointsOfBone(bone);
      const want = (c as unknown as { joints: Record<string, number[][]> }).joints[bone];
      if (!mine || !want) continue;
      const worst = mine.map((m, i) => { const w = new THREE.Matrix4().fromArray(want[i]); return Math.hypot(m.elements[12] - w.elements[12], m.elements[13] - w.elements[13], m.elements[14] - w.elements[14]); });
      const rolls = mine.map((m, i) => { const w = new THREE.Matrix4().fromArray(want[i]); const a = new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]).normalize(); const b = new THREE.Vector3(w.elements[0], w.elements[1], w.elements[2]).normalize(); return (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 57.3).toFixed(1); });
      console.log(`  {${c.label}} ${bone} joints pos err ${worst.map((v) => v.toFixed(2)).join(" ")} | x-axis err deg ${rolls.join(" ")}`);
    }
    if (process.env.RIG_LOCAL) for (const bone of process.env.RIG_LOCAL.split(",")) {
      const b = rig.bones.find((x) => x.name === bone)!;
      const rest = (n: string) => new THREE.Matrix4().fromArray(rig.bones.find((x) => x.name === n)!.rest);
      const off = b.parent ? rest(b.parent).invert().multiply(rest(bone)) : rest(bone);
      const loc = (m: THREE.Matrix4, parentPose: THREE.Matrix4) => parentPose.clone().multiply(off).invert().multiply(m);
      const wantL = loc(new THREE.Matrix4().fromArray(c.matrices[bone]), b.parent ? new THREE.Matrix4().fromArray(c.matrices[b.parent]) : new THREE.Matrix4());
      const gotL = loc(solver.pose[solver.indexOf(bone)], b.parent ? solver.pose[solver.indexOf(b.parent)] : new THREE.Matrix4());
      const eu = (m: THREE.Matrix4) => matrixToEuler(m, "XYZ").map((v) => (v * 57.3).toFixed(1)).join(",");
      console.log(`  (${c.label}) ${bone} local rot want [${eu(wantL)}] got [${eu(gotL)}] loc want [${[12, 13, 14].map((k) => wantL.elements[k].toFixed(2))}] got [${[12, 13, 14].map((k) => gotL.elements[k].toFixed(2))}]`);
    }
    if (process.env.RIG_BONE) for (const bone of process.env.RIG_BONE.split(",")) {
      const g = solver.pose[solver.indexOf(bone)];
      const w = new THREE.Matrix4().fromArray(c.matrices[bone]);
      const ang = (o: number) => (Math.acos(Math.min(1, Math.max(-1, new THREE.Vector3(g.elements[o], g.elements[o + 1], g.elements[o + 2]).normalize().dot(new THREE.Vector3(w.elements[o], w.elements[o + 1], w.elements[o + 2]).normalize())))) * 57.3).toFixed(2);
      const f = (m: THREE.Matrix4) => [0, 4, 8, 12].map((o) => `(${[0, 1, 2].map((k) => m.elements[o + k].toFixed(3)).join(",")})`).join(" ");
      const sc = (m: THREE.Matrix4) => [0, 4, 8].map((o) => Math.hypot(m.elements[o], m.elements[o + 1], m.elements[o + 2]).toFixed(3)).join("/");
      console.log(`  <${c.label}> ${bone}: scale got ${sc(g)} want ${sc(w)}; axis errors X ${ang(0)}° Y ${ang(4)}° Z ${ang(8)}°
     got  ${f(g)}
     want ${f(w)}`);
    }
    const belt = (e: { bone: string }) => /bullet|Bullet/.test(e.bone);
    if (process.env.RIG_NOBELT) errs.splice(0, errs.length, ...errs.filter((e) => !belt(e)));
    const bad = errs.filter((e) => e.pos > 0.02 || e.rot > 0.005).sort((a, b) => b.pos + b.rot * 10 - (a.pos + a.rot * 10));
    const maxPos = Math.max(0, ...errs.map((e) => e.pos));
    worst = Math.max(worst, maxPos);
    // the bones that are far from where Blender has them (the belt of bullets is allowed more: it is made of very short bones)
    for (const e of errs) if ((e.pos > 2 || e.rot > 0.21) && !/bullet|Bullet/.test(e.bone)) gross.push(`${c.label}: ${e.bone} (${e.pos.toFixed(2)}, ${(e.rot * 57.3).toFixed(1)}°)`);
    for (const e of errs) if ((e.pos > 4 || e.rot > 0.7) && /bullet|Bullet/.test(e.bone)) gross.push(`${c.label}: ${e.bone} (${e.pos.toFixed(2)}, ${(e.rot * 57.3).toFixed(1)}°)`);
    if (process.env.RIG_DEBUG) {
      const order = solver.evaluationOrder();
      const first = errs.filter((e) => e.pos > 0.02 || e.rot > 0.005).sort((a, b) => order.indexOf(a.bone) - order.indexOf(b.bone)).slice(0, Number(process.env.RIG_DEBUG));
      for (const e of first) {
        const b = rig.bones.find((x) => x.name === e.bone)!;
        console.log(`  [${c.label}] ${e.bone} pos ${e.pos.toFixed(3)} rot ${(e.rot * 57.3).toFixed(1)}° parent=${b.parent} cons=${b.constraints.map((k) => `${k.type}(${k.subtarget ?? ""}${k.owner_space === "LOCAL" ? ",L" : ""})`).join(" ")}`);
      }
    }
    report.push(`${c.label}: ${bad.length} of ${errs.length} bones off; worst ${bad.slice(0, 6).map((e) => `${e.bone} (${e.pos.toFixed(3)}, ${(e.rot * 57.3).toFixed(1)}°)`).join(", ")}`);
  }
  return { report, worst, gross, unsupported: [...solver.unsupported] };
}

for (const name of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".rig.json")).map((f) => f.replace(".rig.json", "")) : []) {
  if (!existsSync(join(dir, `${name}.oracle.json`))) continue;
  test(`the solver poses ${name} as Blender does`, () => {
    const { report, unsupported, gross } = compareAll(name);
    console.log(report.join("\n"));
    if (unsupported.length) console.log("unsupported constraints:", unsupported.join(", "));
    // matching Blender exactly is the aim (the report above shows how far each case is); what is asserted is that no bone is far off
    assert.deepEqual(gross, [], "bones far from where Blender puts them");
  });
}
