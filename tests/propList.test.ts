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
