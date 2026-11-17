// Run with: npm test -- importerMaterial
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MATERIAL, buildVmt, flattenVmt, isPaintedPhongTint, vmtText } from "../src/compiler/vmt.ts";

const proxyOf = (vmt: ReturnType<typeof flattenVmt>, result: string) => vmt.proxies.filter((p) => p.params.resultvar?.toLowerCase() === result);

test("$nocull is written when asked for, and only then", () => {
  assert.equal(flattenVmt(buildVmt({ ...DEFAULT_MATERIAL, noCull: true }, {})).params["$nocull"], "1");
  assert.equal(flattenVmt(buildVmt(DEFAULT_MATERIAL, {})).params["$nocull"], undefined);
});

test("a paintable phong tint puts the painted colour into $phongtint after the paint chain", () => {
  const vmt = flattenVmt(buildVmt({ ...DEFAULT_MATERIAL, paintable: true, paintablePhongTint: true }, {}));
  const tint = proxyOf(vmt, "$phongtint");
  assert.equal(tint.length, 1);
  assert.deepEqual(tint[0], { name: "multiply", params: { srcvar1: "$color2", srcvar2: "$yellow", resultvar: "$phongtint" } });
  // it comes after the chain that makes $color2
  const names = vmt.proxies.map((p) => p.name);
  assert.ok(names.lastIndexOf("multiply") > names.indexOf("selectfirstifnonzero"));
  // not paintable: nothing to take the colour from
  assert.equal(proxyOf(flattenVmt(buildVmt({ ...DEFAULT_MATERIAL, paintablePhongTint: true }, {})), "$phongtint").length, 0);
  assert.match(vmtText(buildVmt({ ...DEFAULT_MATERIAL, paintable: true, paintablePhongTint: true }, {})), /"resultVar"\s+"\$phongtint"/);
});

test("the Balloonihelm's proxy is recognised as the switch", () => {
  assert.equal(isPaintedPhongTint("Multiply", [{ key: "srcVar1", value: "$color2" }, { key: "srcVar2", value: "$yellow" }, { key: "resultVar", value: "$phongtint" }]), true);
  assert.equal(isPaintedPhongTint("Multiply", [{ key: "srcVar1", value: "$color2" }, { key: "resultVar", value: "$envmaptint" }]), false);
});
