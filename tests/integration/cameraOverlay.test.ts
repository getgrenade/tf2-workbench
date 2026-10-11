import test from "node:test";
import assert from "node:assert/strict";
import { CameraOverlay } from "../../src/viewer/cameraOverlay";
import { BORDER_PRESETS, DEFAULT_BORDER, DEFAULT_OVERLAY_GRID, drawOverlay, elementBounds, parseOverlay, snapOverlayPoint, type CameraOverlayData } from "../../src/viewer/overlayData";

class Context {
  font = "10px sans-serif"; globalAlpha = 1; fillStyle = ""; strokeStyle = ""; lineWidth = 1; textAlign = "left"; textBaseline = "top";
  ops: { type: string; args: any[]; alpha: number }[] = [];
  record(type: string, args: any[]) { this.ops.push({ type, args, alpha: this.globalAlpha }); }
  save() {} restore() {} beginPath() {} rect() {} clip() {} setTransform() {} setLineDash() {}
  moveTo(...args: any[]) { this.record("move", args); } lineTo(...args: any[]) { this.record("line", args); }
  measureText(text: string) { return { width: text.length * Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10) / 2 }; }
  fillText(...args: any[]) { this.record("text", args); }
  drawImage(...args: any[]) { this.record("image", args.slice(1)); }
  roundRect(...args: any[]) { this.record("border", args); }
  stroke() {} strokeRect() {} fillRect(...args: any[]) { this.record("fill", args); }
}
class Dom {
  className = ""; hidden = false; textContent = ""; type = ""; value = ""; checked = false; disabled = false;
  style: Record<string, string> = {}; children: Dom[] = []; clientWidth = 800; clientHeight = 600;
  onclick: (() => void) | null = null; oninput: (() => void) | null = null;
  listeners = new Map<string, ((event: any) => void)[]>(); captures = new Set<number>(); ctx = new Context();
  append(...elements: Dom[]) { this.children.push(...elements); } prepend(element: Dom) { this.children.unshift(element); }
  replaceChildren(...elements: Dom[]) { this.children = elements; }
  remove() {} setAttribute() {}
  get valueAsNumber() { return Number(this.value); }
  getContext() { return this.ctx; }
  addEventListener(name: string, fn: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  getBoundingClientRect() { return { left: parseFloat(this.style.left ?? "0"), top: parseFloat(this.style.top ?? "0"), width: parseFloat(this.style.width ?? "800"), height: parseFloat(this.style.height ?? "600") }; }
  setPointerCapture(id: number) { this.captures.add(id); } hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); this.emit("lostpointercapture", { pointerId: id }); }
  emit(name: string, props: Record<string, unknown> = {}) { const event = { button: 0, pointerId: 1, clientX: 400, clientY: 300, target: { tagName: "CANVAS" }, preventDefault() {}, stopPropagation() {}, ...props }; for (const fn of this.listeners.get(name) ?? []) fn(event); }
}
function fixture() {
  (globalThis as any).document = { createElement: () => new Dom() };
  const window = new Dom(); (globalThis as any).window = window;
  const camera = { id: "one", ratio: "1:1", height: 2048, overlay: undefined as CameraOverlayData | undefined };
  let changes = 0;
  const rig = { activeCamera: camera, overlayEditing: "one" as string | null, onChange() { changes++; }, stopOverlayEditing() { this.overlayEditing = null; } };
  const editor = new CameraOverlay(rig as any, new Dom() as any); editor.update();
  return { editor, rig, camera, window, get changes() { return changes; } };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("overlay parsing detaches data, clamps invalid values and rejects malformed icon sources", () => {
  const raw = { border: { ...DEFAULT_BORDER, width: 20, opacity: -1, color: "bad" }, elements: [
    { id: "text", kind: "text", text: "Hello", x: NaN, y: -4, size: 0, opacity: 2, color: "#123456", bold: true },
    { id: "unsafe", kind: "icon", image: "../../bad" }, { id: "web", kind: "icon", image: "https://example.com/icon.png" },
    { id: "icon", kind: "icon", image: "backpack/player/items/all_class/test", label: "Hat", x: .2, y: .4, size: .15, opacity: 1 },
  ] };
  const parsed = parseOverlay(raw)!; assert.equal(parsed.elements.length, 2);
  assert.equal(parsed.border!.width, .1); assert.equal(parsed.border!.opacity, 0); assert.equal(parsed.border!.color, DEFAULT_BORDER.color);
  assert.equal(parsed.elements[0].x, .5); assert.equal(parsed.elements[0].y, 0); assert.equal(parsed.elements[0].size, .01);
  parsed.elements[0].x = .8; assert.ok(Number.isNaN(raw.elements[0].x));
  assert.equal(parseOverlay(undefined), undefined);
});
