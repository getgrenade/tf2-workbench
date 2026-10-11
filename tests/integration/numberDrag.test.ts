import test from "node:test";
import assert from "node:assert/strict";
import { attachNumberDrag } from "../../src/viewer/numberDrag";

class Target {
  listeners = new Map<string, ((event: any) => void)[]>();
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
  captured: number | null = null;
  addEventListener(name: string, fn: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  setPointerCapture(id: number) { this.captured = id; }
  hasPointerCapture(id: number) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
  emit(name: string, props: Record<string, unknown> = {}) {
    const event = { button: 0, pointerId: 1, clientX: 100, shiftKey: false, target: this, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...props };
    for (const fn of this.listeners.get(name) ?? []) fn(event);
    return event;
  }
}
function fixture() {
  const row = new Target(), win = new Target();
  const doc = { activeElement: null as unknown }; (globalThis as any).document = doc; (globalThis as any).window = win;
  const input = { value: "10", disabled: false, get valueAsNumber() { return Number(this.value); }, closest: () => row, focus() { doc.activeElement = this; }, select() {} };
  let actual = 10, starts = 0, ends = 0;
  attachNumberDrag(input as any, .25, { start() { starts++; }, change(value) { actual = value; }, end() { ends++; } });
  return { row, win, doc, input, result: () => ({ actual, starts, ends }) };
}
test("horizontal scrub updates continuously, captures the pointer and suppresses typing after a drag", () => {
  const { row, input, result, doc } = fixture();
  row.emit("pointerdown", { target: input }); row.emit("pointermove", { clientX: 102 }); assert.equal(result().starts, 0);
  row.emit("pointermove", { clientX: 140 }); assert.equal(result().actual, 20); assert.equal(row.captured, 1);
  row.emit("pointermove", { clientX: 60 }); assert.equal(result().actual, 0);
  row.emit("pointerup"); assert.deepEqual(result(), { actual: 0, starts: 1, ends: 1 }); assert.equal(row.captured, null);
  assert.equal(row.emit("click").prevented, true); assert.equal(doc.activeElement, null);
});
test("a click enters typing; focused inputs and disabled inputs preserve their normal interaction", () => {
  const { row, input, doc, result } = fixture();
  row.emit("pointerdown", { target: input }); row.emit("pointerup"); assert.equal(doc.activeElement, input);
  assert.equal(row.emit("pointerdown", { target: input }).prevented, false);
  row.emit("pointermove", { clientX: 200 }); assert.equal(result().actual, 10);
  input.disabled = true; doc.activeElement = null; row.emit("pointerdown"); assert.equal(row.captured, null);
});
test("Shift provides fine adjustment, Escape and canceled pointers restore the original value", () => {
  const { row, win, input, result } = fixture();
  row.emit("pointerdown"); row.emit("pointermove", { clientX: 140, shiftKey: true }); assert.equal(result().actual, 11);
  win.emit("keydown", { key: "Escape" }); assert.equal(result().actual, 10); assert.equal(input.value, "10"); assert.equal(result().ends, 1);
  row.emit("pointerdown"); row.emit("pointermove", { clientX: 140 }); row.emit("pointercancel");
  assert.deepEqual(result(), { actual: 10, starts: 2, ends: 2 }); assert.equal(row.classes.has("scrubbing"), false);
});
