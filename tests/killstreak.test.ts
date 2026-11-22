import { test } from "node:test";
import assert from "node:assert/strict";
import { killstreakEyes, parseKillstreak, sheenFrame, sheenTint, sheenWait } from "../src/viewer/killstreak.ts";
import type { ModelData } from "../src/viewer/payload.ts";

test("a sheen is the game's colour for the team; Team Shine alone turns blue on BLU", () => {
  assert.deepEqual(sheenTint(1, 0)!.map((v) => Math.round(v * 255)), [200, 20, 15]);
  assert.deepEqual(sheenTint(1, 1)!.map((v) => Math.round(v * 255)), [40, 98, 200]);
  assert.deepEqual(sheenTint(7, 1), sheenTint(7, 0));
  assert.equal(sheenTint(0, 0), null);
});

test("a killstreaker's eyes: both eyes but the Demoman's left, lvl2 from 10 kills, the sheen's colours on control points 9 and 10", () => {
  const eyes = killstreakEyes({ sheen: 2, effect: 2002, high: false }, 0, "soldier");
  assert.deepEqual(eyes.map((x) => [x.system, x.attachment]), [["killstreak_t1_lvl1", "eyeglow_R"], ["killstreak_t1_lvl1", "eyeglow_L"]]);
  assert.equal(eyes[0].colors.length, 6);
  assert.deepEqual(killstreakEyes({ sheen: 2, effect: 2008, high: true }, 0, "demoman").map((x) => [x.system, x.attachment]), [["killstreak_t7_lvl2", "eyeglow_R"]]);
  assert.deepEqual(killstreakEyes({ sheen: 2, effect: 0, high: true }, 0, "scout"), []);
});

test("killstreaks are read back strictly, the sheen waits five seconds below a high streak, and the mask runs along the longest side", () => {
  assert.deepEqual(parseKillstreak({ sheen: 3, effect: 2005, high: true }), { sheen: 3, effect: 2005, high: true });
  assert.deepEqual(parseKillstreak({ sheen: 0, effect: 2005 }), null);
  assert.deepEqual(parseKillstreak({ sheen: 3, effect: 9999 }), { sheen: 3, effect: 0, high: false });
  assert.deepEqual(parseKillstreak({ sheen: 3, effect: 0, speed: 2 }), { sheen: 3, effect: 0, high: false, speed: 2 });
  assert.deepEqual(parseKillstreak({ sheen: 3, effect: 0, speed: 1 }), { sheen: 3, effect: 0, high: false });
  assert.equal(parseKillstreak({ sheen: 3, effect: 0, speed: 99 })!.speed, 4);
  assert.equal(sheenWait({ sheen: 1, effect: 0, high: false }), 5);
  assert.equal(sheenWait({ sheen: 1, effect: 0, high: true }), 0);
  const data = { bodyParts: [{ models: [{ meshes: [{ positions: new Float32Array([0, -2, 1, 4, 30, 3]) }] }] }] } as unknown as ModelData;
  assert.deepEqual(sheenFrame(data), { dir: 1, scale: [32, 4], offset: [-2, 0] });
});
