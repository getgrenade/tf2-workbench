import { test } from "node:test";
import assert from "node:assert/strict";
import { isRobotOnlyItem } from "../src/viewer/robotItems.ts";

test("the robots' own cosmetics are told apart from players' items with robot in their names", () => {
  for (const name of ["tw_scoutbot_armor", "tw_scoutbot_hat", "tw_medibot_chariot", "tw_spybot_hood", "MvM GateBot Light Scout"]) assert.equal(isRobotOnlyItem({ name }), true, name);
  for (const name of ["Robot Chicken Hat", "Pyrobotics Pack", "hw2013_py40_automaton", "Botler 2000", "sum19_bottle_cap"]) assert.equal(isRobotOnlyItem({ name }), false, name);
});
