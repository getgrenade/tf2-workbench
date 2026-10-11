// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { flexKey, flexRamp, flexRawValue, flexRealValue, runFlexRules } from "../src/viewer/flex.ts";

const ctrl = (name: string, min = 0, max = 1) => ({ name, min, max });

test("a FETCH1 rule copies the controller value into its descriptor", () => {
  const model = { flexDescCount: 2, flexControllers: [ctrl("AH")], flexRules: [{ flex: 1, ops: [[2, 0]] as [number, number][] }] };
  const w = runFlexRules(model, new Map([[flexKey("ah"), 0.75]]));
  assert.deepEqual([...w], [0, 0.75]);
});

test("controllers are matched by name, case-insensitively, and unknown names read 0", () => {
  // A cosmetic with its own controller list: only "Y" exists in the player's globals.
  const model = {
    flexDescCount: 2,
    flexControllers: [ctrl("y"), ctrl("HappyBigClosed")],
    flexRules: [
      { flex: 0, ops: [[2, 0]] as [number, number][] },
      { flex: 1, ops: [[2, 1]] as [number, number][] },
    ],
  };
  const w = runFlexRules(model, new Map([[flexKey("Y"), 0.5]]));
  assert.deepEqual([...w], [0.5, 0]);
});

test("arithmetic ops run on the stack (1 - fetch) * const", () => {
  const model = {
    flexDescCount: 1,
    flexControllers: [ctrl("blink")],
    // CONST 1, FETCH1 0, SUB, CONST 0.5, MUL
    flexRules: [{ flex: 0, ops: [[1, 1], [2, 0], [5, 0], [1, 0.5], [6, 0]] as [number, number][] }],
  };
  assert.equal(runFlexRules(model, new Map([["blink", 0.5]]))[0], 0.25);
});

test("the weight ramp rises to the plateau and falls again", () => {
  const t = [0, 1, 10, 11] as const;
  assert.equal(flexRamp(0, t), 0);
  assert.equal(flexRamp(0.5, t), 0.5);
  assert.equal(flexRamp(1, t), 1);
  assert.equal(flexRamp(10.5, t), 0.5);
  assert.equal(flexRamp(11, t), 0);
});

test("the default slider position is real value 0, as in hlmv", () => {
  const twoWay = ctrl("multi_CloseLid", -1, 1);
  assert.equal(flexRawValue(twoWay, 0), 0.5);
  assert.equal(flexRealValue(twoWay, 0.5), 0);
  assert.equal(flexRawValue(ctrl("AH"), 0), 0);
});

test("restored controller values stay within the normal model range", async () => {
  const { flexGlobalsFor } = await import("../src/viewer/flexUi.ts");
  const model = { flexControllers: [{ name: "smile", min: 0, max: 1 }, { name: "frown", min: 0, max: 1 }], flexDescCount: 2, flexRules: [{ flex: 0, ops: [[2, 0]] }, { flex: 1, ops: [[2, 1]] }] };
  const globals = flexGlobalsFor(model as unknown as import("../src/viewer/payload.ts").ModelData, new Map([["smile", 12.5], ["frown", -8.75]]));
  assert.deepEqual(Array.from(runFlexRules(model as Parameters<typeof runFlexRules>[0], globals)), [1, 0]);
});
