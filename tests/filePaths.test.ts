// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedPath } from "../src/filePaths.ts";

test("a model row takes the first model file dropped, whatever else came with it", () => {
  const dropped = ["C:\art\readme.txt", "C:\art\crate_diffuse.tga", "C:\art\Crate.FBX", "C:\art\other.smd"];
  assert.equal(acceptedPath("fbx", dropped), "C:\art\Crate.FBX");
  assert.equal(acceptedPath("tga", dropped), "C:\art\crate_diffuse.tga");
  assert.equal(acceptedPath("smd", dropped), "C:\art\other.smd");
  assert.equal(acceptedPath("fbx", ["C:\art\notes.txt"]), null);
});

test("a folder row takes a path with no extension", () => {
  assert.equal(acceptedPath("folder", ["C:\art\file.tga", "C:\tf\custom\my_props"]), "C:\tf\custom\my_props");
  assert.equal(acceptedPath("folder", ["C:\art\file.tga"]), null);
});
