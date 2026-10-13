// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterProps, parsePropPaths, propFolders, propLabel } from "../src/props/propList.ts";

const files = [
  "models/props_c17/barrel001.mdl", "models/props_c17/barrel001.vvd", "models/props_c17/barrel001.dx90.vtx",
  "models/props_c17/furniture/chair01.mdl", "models/props_c17/furniture/table01.mdl",
  "models/props_2fort/sign.mdl", "models/props/crate.mdl", "models/player/soldier.mdl", "models/weapons/c_bat.mdl", "models/mvm/tank.mdl",
  "models\\props_c17\\barrel001.mdl",
];

test("only the .mdl files of the prop folders make the catalogue, once each", () => {
  const entries = parsePropPaths(files);
  assert.deepEqual(entries.map((e) => e.cls), ["props/crate", "props_2fort/sign", "props_c17/barrel001", "props_c17/furniture/chair01", "props_c17/furniture/table01", "mvm/tank"].sort((a, b) => {
    const fa = a.slice(0, a.lastIndexOf("/")), fb = b.slice(0, b.lastIndexOf("/"));
    return fa === fb ? a.localeCompare(b) : fa.localeCompare(fb);
  }));
  const barrel = entries.find((e) => e.name === "barrel001")!;
  assert.equal(barrel.path, "models/props_c17/barrel001.mdl");
  assert.equal(barrel.folder, "props_c17");
});

test("folders are listed in tree order with the number of props in and below them", () => {
  const folders = propFolders(parsePropPaths(files));
  const c17 = folders.find((f) => f.path === "props_c17")!;
  assert.equal(c17.count, 3);
  assert.equal(c17.depth, 0);
  const furniture = folders.find((f) => f.path === "props_c17/furniture")!;
  assert.deepEqual([furniture.name, furniture.depth, furniture.count], ["furniture", 1, 2]);
  assert.ok(folders.findIndex((f) => f.path === "props_c17") < folders.findIndex((f) => f.path === "props_c17/furniture"));
});

test("a search needs every word, and a folder includes its subfolders", () => {
  const entries = parsePropPaths(files);
  assert.deepEqual(filterProps(entries, "chair").map((e) => e.name), ["chair01"]);
  assert.deepEqual(filterProps(entries, "c17 table").map((e) => e.name), ["table01"]);
  assert.deepEqual(filterProps(entries, "", "props_c17").map((e) => e.name), ["barrel001", "chair01", "table01"]);
  assert.deepEqual(filterProps(entries, "", "props_c17/furniture").map((e) => e.name), ["chair01", "table01"]);
  assert.equal(filterProps(entries, "zzz").length, 0);
});

test("a prop is labelled by its model's name", () => {
  assert.equal(propLabel("props_c17/furniture/chair01"), "chair01");
  assert.equal(propLabel("crate"), "crate");
});

test("props are listed by the game whose archives hold them", async () => {
  const { propGames, gameLabel } = await import("../src/props/propList.ts");
  const entries = parsePropPaths([
    { path: "models/props_c17/barrel001.mdl", game: "hl2" }, { path: "models/props_2fort/sign.mdl", game: "tf2" },
    { path: "models/props_junk/crate.mdl", game: "tf2" }, { path: "models/props_lab/desk.mdl", game: "hl2" }, "models/props/plain.mdl",
  ]);
  assert.deepEqual(new Set(filterProps(entries, "", "", "tf2").map((e) => e.name)), new Set(["sign", "crate"]));
  assert.deepEqual(new Set(filterProps(entries, "", "", "hl2").map((e) => e.name)), new Set(["barrel001", "desk"]));
  assert.equal(filterProps(entries, "").length, 5);
  const games = propGames(entries);
  assert.equal(games[0].id, "tf2");
  assert.deepEqual(games.map((g) => [g.id, g.count]), [["tf2", 2], ["", 1], ["hl2", 2]]);
  assert.equal(gameLabel("hl2"), "Half-Life 2");
});

test("the models of a mounted folder are props whatever their folder, listed under the folder's name, after the games", async () => {
  const { propGames, gameLabel, isCustomGame } = await import("../src/props/propList.ts");
  const entries = parsePropPaths([
    { path: "models/zmb/perk_machine/accurate.mdl", game: "custom:perk_machines" }, { path: "models/zmb/perk_machine/cobalt_cola.mdl", game: "custom:perk_machines" },
    { path: "models/loose.mdl", game: "custom:perk_machines" }, { path: "models/props_2fort/sign.mdl", game: "tf2" }, { path: "models/player/soldier.mdl", game: "tf2" },
    { path: "models/props_c17/barrel001.mdl", game: "hl2" },
  ]);
  assert.deepEqual(filterProps(entries, "", "", "custom:perk_machines").map((e) => e.cls), ["zmb/perk_machine/accurate", "zmb/perk_machine/cobalt_cola"]);
  assert.deepEqual(propGames(entries).map((g) => g.id), ["tf2", "hl2", "custom:perk_machines"]);
  assert.equal(gameLabel("custom:perk_machines"), "Custom: perk_machines");
  assert.ok(isCustomGame("custom:x") && !isCustomGame("tf2"));
});
