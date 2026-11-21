import test from "node:test";
import assert from "node:assert/strict";
import { fadeAmount, maskIcon } from "../../src/compiler/iconMask";
import { ICON_SAFE_ROWS, decodeTga, encodeTga, iconProblem } from "../../src/compiler/tga";

const solid = () => { const p = new Uint8Array(512 * 512 * 4); for (let i = 0; i < p.length; i += 4) p.set([200, 100, 50, 255], i); return p; };
const at = (p: Uint8Array, y: number) => [...p.slice((y * 512 + 100) * 4, (y * 512 + 100) * 4 + 4)];

test("everything outside the safe rows is cut away, so the icon passes the importer's check", () => {
  const p = solid();
  const cut = maskIcon(p, null);
  assert.equal(cut, 512 * (ICON_SAFE_ROWS.start + 512 - ICON_SAFE_ROWS.end));
  assert.deepEqual(at(p, ICON_SAFE_ROWS.start - 1), [0, 0, 0, 0]);
  assert.deepEqual(at(p, ICON_SAFE_ROWS.end), [0, 0, 0, 0]);
  assert.deepEqual(at(p, ICON_SAFE_ROWS.start), [200, 100, 50, 255]);
  assert.deepEqual(at(p, ICON_SAFE_ROWS.end - 1), [200, 100, 50, 255]);
  assert.equal(iconProblem(decodeTga(encodeTga(p, 512, 512))), null);
});

test("the fade eases the bottom of the safe zone out, colour and alpha together", () => {
  const bottom = (height: number, curve: number) => ({ top: null, bottom: { height, curve } });
  const fade = bottom(100, 1);
  assert.equal(fadeAmount(ICON_SAFE_ROWS.end - 101, fade), 1);
  assert.equal(fadeAmount(ICON_SAFE_ROWS.end, fade), 0);
  assert.ok(Math.abs(fadeAmount(ICON_SAFE_ROWS.end - 50, fade) - 0.5) < 1e-9);
  assert.equal(fadeAmount(300, null), 1);
  assert.ok(fadeAmount(ICON_SAFE_ROWS.end - 50, bottom(100, 2)) < 0.5, "a higher curve drops faster toward the end");
  const p = solid();
  maskIcon(p, fade);
  const middle = at(p, ICON_SAFE_ROWS.end - 50);
  assert.ok(middle[3] > 100 && middle[3] < 160 && middle[0] === Math.round(200 * middle[3] / 255), middle.join());
  const last = at(p, ICON_SAFE_ROWS.end - 1);
  assert.ok(last[3] <= 3 && last[0] <= 3, "almost nothing at the last row");
  assert.deepEqual(at(p, ICON_SAFE_ROWS.end - 120), [200, 100, 50, 255], "above the fade nothing changes");
  assert.equal(iconProblem(decodeTga(encodeTga(p, 512, 512))), null);
});

test("the top fade eases the top of the safe zone in, and both fades together multiply", () => {
  const top = { height: 100, curve: 1 };
  assert.equal(fadeAmount(ICON_SAFE_ROWS.start + 100, { top, bottom: null }), 1);
  assert.ok(fadeAmount(ICON_SAFE_ROWS.start, { top, bottom: null }) < 0.02, "almost nothing at the first row");
  assert.ok(Math.abs(fadeAmount(ICON_SAFE_ROWS.start + 49, { top, bottom: null }) - 0.5) < 1e-9);
  const both = { top: { height: 300, curve: 1 }, bottom: { height: 300, curve: 1 } };
  const y = 250;
  assert.ok(Math.abs(fadeAmount(y, both) - fadeAmount(y, { top: both.top, bottom: null }) * fadeAmount(y, { top: null, bottom: both.bottom })) < 1e-12);
  const p = solid();
  maskIcon(p, { top, bottom: null });
  assert.ok(at(p, ICON_SAFE_ROWS.start)[3] <= 3, "the first row is almost gone");
  assert.deepEqual(at(p, ICON_SAFE_ROWS.end - 1), [200, 100, 50, 255], "the bottom is left alone");
});
