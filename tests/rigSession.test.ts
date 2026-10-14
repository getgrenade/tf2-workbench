// A pose put on the controls (snapFromGame) has to give the pose back through the rig. Needs a rig and its oracle file in rigs/ (see rigSolver.test.ts).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as THREE from "three";
import { parseRig } from "../src/rig/rigData.ts";
import { BLENDER_TO_MODEL, RigSession } from "../src/rig/rigSession.ts";

(globalThis as { RIG_FIT_DEBUG?: boolean }).RIG_FIT_DEBUG = !!process.env.RIG_FIT_DEBUG;
const dir = process.env.RIG_TEST_DIR ?? join(process.cwd(), "rigs");

for (const name of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".rig.json")).map((f) => f.replace(".rig.json", "")) : []) {
  if (!existsSync(join(dir, `${name}.oracle.json`))) continue;
  test(`a pose put on the controls of ${name} comes back through the rig`, () => {
    const rig = parseRig(readFileSync(join(dir, `${name}.rig.json`), "utf8"));
    const oracle = JSON.parse(readFileSync(join(dir, `${name}.oracle.json`), "utf8")) as { cases: { label: string; matrices: Record<string, number[]> }[] };
    const session = new RigSession(rig);
    const lines: string[] = [];
    const bad: string[] = [];
    // poses a character can have: the ones where IK stretches the arms or legs cannot be made with FK controls (their lengths differ)
    for (const c of oracle.cases.filter((x) => /^(rest|fk all|fk arms|fk legs|fingers|ik legs|half)/.test(x.label))) {
      const world = (g: string) => (c.matrices[session.gameBones.get(g.toLowerCase()) ?? g] ? new THREE.Matrix4().multiplyMatrices(BLENDER_TO_MODEL, new THREE.Matrix4().fromArray(c.matrices[session.gameBones.get(g.toLowerCase()) ?? g])) : null);
      session.snapFromGame(world);
      const errs: { bone: string; pos: number; rot: number }[] = [];
      for (const game of session.gameBones.values()) {
        // the body the rig is for: the bones of the skeleton the game animates (helpers, the weapon and the belt hang on other things)
        if (!/^bip_/.test(game)) continue;
        const want = world(game);
        const got = session.gameWorld(game);
        if (!want || !got) continue;
        const pos = Math.hypot(got.elements[12] - want.elements[12], got.elements[13] - want.elements[13], got.elements[14] - want.elements[14]);
        const ang = (o: number) => Math.acos(Math.min(1, Math.max(-1, new THREE.Vector3(got.elements[o], got.elements[o + 1], got.elements[o + 2]).normalize().dot(new THREE.Vector3(want.elements[o], want.elements[o + 1], want.elements[o + 2]).normalize()))));
        errs.push({ bone: game, pos, rot: Math.max(ang(4), ang(8)) });
      }
      errs.sort((a, b) => b.pos + b.rot * 10 - (a.pos + a.rot * 10));
      lines.push(`${c.label}: ${errs.length} game bones; worst ${errs.slice(0, 5).map((e) => `${e.bone} (${e.pos.toFixed(2)}, ${(e.rot * 57.3).toFixed(1)}°)`).join(", ")}`);
      for (const e of errs) if (e.pos > 3 || e.rot > 0.35) bad.push(`${c.label}: ${e.bone} (${e.pos.toFixed(2)}, ${(e.rot * 57.3).toFixed(1)}°)`);
    }
    console.log(lines.join("\n"));
    assert.deepEqual(bad.slice(0, 12), [], "game bones far from the pose that was put on the controls");
  });
}
