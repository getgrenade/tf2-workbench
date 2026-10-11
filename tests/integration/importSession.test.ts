import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ImportSessionError, parseImportSession, settingsFromVmt } from "../../src/compiler/importSession";
import { parseKv } from "../../src/compiler/kv";
import { DEFAULT_MATERIAL, buildVmt, vmtText, type MaterialSettings } from "../../src/compiler/vmt";

const FOLDER = "C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf/workshop/import_source/";

test("what the compiler writes into a material text it reads back as the same settings", () => {
  const settings: MaterialSettings[] = [
    { ...DEFAULT_MATERIAL },
    { ...DEFAULT_MATERIAL, phongExponent: 60, phongBoost: 2.5, rimLight: false, rimExponent: 9, rimBoost: 0.5, rimMask: true, halfLambert: true, baseAlphaPhongMask: true, translucent: true, alphaTest: true, additive: true },
    { ...DEFAULT_MATERIAL, paintable: true, blendTintColorOverBase: 0.68, colorTintBase: [130, 91, 83], selfIllum: true, selfIllumTint: [255, 128, 0], envmap: "env_cubemap", envmapMask: "$normalmapalphaenvmapmask", envmapTint: [51, 102, 255] },
  ];
  for (const s of settings) {
    const text = vmtText(buildVmt(s, { color: "x/c", normal: "x/n", phongexponent: "x/e", illum: "x/i" }));
    assert.deepEqual(settingsFromVmt(parseKv(text)), s);
  }
});

test("a file that is not a session is refused with a reason", () => {
  assert.throws(() => parseImportSession("hello"), ImportSessionError);
  assert.throws(() => parseImportSession('"data" { "other" { } }'), /ImportSession/);
});

const wayward = FOLDER + "wayward_wrap.txt";
const bounty = FOLDER + "bounty_brim_style4.txt";
const ours = FOLDER + "govno.txt";
import { CompilerSession, type SessionIo } from "../../src/compiler/session";
import { readdirSync, statSync } from "node:fs";

const spectral = FOLDER + "a_spectral_arms.txt";