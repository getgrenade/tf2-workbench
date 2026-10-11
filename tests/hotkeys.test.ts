// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOTKEYS, conflictsOf, displayBinding, formatBinding, hotkeyMatches, mouseButtonOf, parseBinding, redoMatches, setHotkeyOverrides, toolOfCode, validFor, binding, hotkeyOverrides, hotkeyDef,
} from "../src/hotkeys.ts";

const key = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) =>
  ({ code, ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt, shiftKey: !!mods.shift });

test("bindings round-trip and read well", () => {
  assert.deepEqual(parseBinding("Ctrl+Shift+KeyZ"), { code: "KeyZ", ctrl: true, alt: false, shift: true });
  assert.equal(formatBinding(parseBinding("Shift+Ctrl+KeyZ")!), "Ctrl+Shift+KeyZ");
  assert.equal(parseBinding(""), null);
  assert.equal(parseBinding("Ctrl+"), null);
  assert.equal(parseBinding("Ctrl+ControlLeft"), null, "a modifier alone is not a binding");
  assert.equal(parseBinding("Hyper+KeyZ"), null);
  assert.equal(displayBinding("Ctrl+KeyZ"), "Ctrl + Z");
  assert.equal(displayBinding("Mouse1"), "MMB");
  assert.equal(displayBinding("Digit4"), "4");
  assert.equal(displayBinding(""), "—");
});

test("every default is a valid binding for its own action, and ids are unique", () => {
  setHotkeyOverrides({});
  assert.equal(new Set(HOTKEYS.map((h) => h.id)).size, HOTKEYS.length);
  for (const h of HOTKEYS) assert.ok(validFor(h, h.default), h.id);
});

test("a key matches with exactly the modifiers of its binding", () => {
  setHotkeyOverrides({});
  assert.ok(hotkeyMatches("edit.copy", key("KeyC", { ctrl: true })));
  assert.ok(!hotkeyMatches("edit.copy", key("KeyC")));
  assert.ok(!hotkeyMatches("edit.copy", key("KeyC", { ctrl: true, shift: true })));
  assert.ok(hotkeyMatches("select.box", key("KeyQ")));
  assert.ok(!hotkeyMatches("select.box", key("KeyQ", { shift: true })));
  assert.ok(hotkeyMatches("edit.copy", { code: "KeyC", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }), "Cmd counts as Ctrl");
});

test("redo is its own key or undo with Shift", () => {
  setHotkeyOverrides({});
  assert.ok(redoMatches(key("KeyY", { ctrl: true })));
  assert.ok(redoMatches(key("KeyZ", { ctrl: true, shift: true })));
  assert.ok(!redoMatches(key("KeyZ", { ctrl: true })));
  setHotkeyOverrides({ "edit.undo": "KeyU" });
  assert.ok(redoMatches(key("KeyU", { shift: true })));
  assert.ok(!hotkeyMatches("edit.undo", key("KeyZ", { ctrl: true })), "the old key no longer undoes");
  setHotkeyOverrides({});
});

test("the gizmo tools follow their keys", () => {
  setHotkeyOverrides({});
  assert.equal(toolOfCode("KeyW"), "move");
  assert.equal(toolOfCode("KeyE"), "rotate");
  assert.equal(toolOfCode("KeyR"), "scale");
  assert.equal(toolOfCode("KeyQ"), null);
  setHotkeyOverrides({ "tool.move": "KeyG", "tool.rotate": "", "tool.scale": "KeyS" });
  assert.equal(toolOfCode("KeyG"), "move");
  assert.equal(toolOfCode("KeyW"), null);
  assert.equal(toolOfCode("KeyE"), null, "no key is none");
  assert.equal(toolOfCode("KeyS"), "scale");
  setHotkeyOverrides({});
});

test("a tool takes a key alone and a mouse action takes a button alone", () => {
  assert.ok(!validFor(hotkeyDef("tool.move"), "Shift+KeyW"));
  assert.ok(!validFor(hotkeyDef("tool.move"), "Mouse0"));
  assert.ok(validFor(hotkeyDef("edit.copy"), "Alt+KeyC"));
  assert.ok(!validFor(hotkeyDef("edit.copy"), "Mouse1"));
  assert.ok(validFor(hotkeyDef("nav.pan"), "Mouse2"));
  assert.ok(!validFor(hotkeyDef("nav.pan"), "Shift+Mouse2"));
  assert.ok(!validFor(hotkeyDef("nav.pan"), "Mouse3"));
  assert.ok(!validFor(hotkeyDef("nav.pan"), "KeyP"));
});

test("stored bindings that make no sense are dropped, the rest are kept", () => {
  setHotkeyOverrides({ "tool.move": "Ctrl+KeyG", "nope.nothing": "KeyG", "view.focus": "KeyG", "select.box": "", "nav.pan": "Mouse0" });
  assert.deepEqual(hotkeyOverrides(), { "view.focus": "KeyG", "select.box": "", "nav.pan": "Mouse0" });
  assert.equal(binding("tool.move"), "KeyW");
  assert.equal(binding("select.box"), "");
  assert.equal(mouseButtonOf("nav.pan"), 0);
  assert.equal(mouseButtonOf("nav.orbit"), 0);
  setHotkeyOverrides({ "nav.orbit": "" });
  assert.equal(mouseButtonOf("nav.orbit"), -1);
  setHotkeyOverrides({});
});

test("clashes are between actions that can be pressed together", () => {
  setHotkeyOverrides({});
  assert.deepEqual(conflictsOf("view.focus", "KeyA"), ["view.focusAll"]);
  assert.deepEqual(conflictsOf("view.focus", "KeyF"), []);
  assert.deepEqual(conflictsOf("play.toggle", "Space"), [], "the outliner's Space is only read in the outliner");
  assert.deepEqual(conflictsOf("outliner.rename", "Space"), ["outliner.toggle"]);
  assert.deepEqual(conflictsOf("nav.pan", "Mouse0"), ["nav.orbit"]);
});
