import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { importFbx, readFbxAxes, MAYA_AXES } from "../../src/compiler/fbx";

// FBXLoader asks for an image element for every texture the file names; the blank-image URL needs no network, but node needs a stand-in.
(globalThis as any).document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_v: string) {} }) };

const buffer = (path: string) => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

test("a text FBX declares its axes in GlobalSettings", () => {
  const ascii = (up: number, sign: number, front: number, fsign: number) => new TextEncoder().encode(`; FBX 7.4.0 project file
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",${up}
		P: "UpAxisSign", "int", "Integer", "",${sign}
		P: "FrontAxis", "int", "Integer", "",${front}
		P: "FrontAxisSign", "int", "Integer", "",${fsign}
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
	}
}`).buffer as ArrayBuffer;
  assert.deepEqual(readFbxAxes(ascii(2, 1, 1, -1)), { right: [1, 0, 0], up: [0, 0, 1], front: [0, -1, 0] });
  assert.deepEqual(readFbxAxes(ascii(1, 1, 2, 1)), MAYA_AXES);
  assert.deepEqual(readFbxAxes(new TextEncoder().encode("; nothing here").buffer as ArrayBuffer), MAYA_AXES);
});
