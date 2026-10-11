import { cameraFrame, cameraSize, type SceneCamera } from "./cameraData";
import { accentHex } from "../theme";
import type { CameraRig } from "./cameraRig";
import { overlayItemIcon } from "./itemIcons";
import { BORDER_PRESETS, DEFAULT_BORDER, DEFAULT_TEXT_GLOW, DEFAULT_TEXT_OUTLINE, DEFAULT_TEXT_SHADOW, DEFAULT_OVERLAY_GRID, drawOverlay, elementBounds, MAX_BACKGROUND_CHARS, MAX_OVERLAY_IMAGES, REFERENCE_SIZE, snapOverlayPoint, type CameraOverlayData, type OverlayBackground, type OverlayElement, type OverlayGrid, type OverlayImage, type OverlayText } from "./overlayData";
import { ensureOverlayFont, OVERLAY_FONTS } from "./overlayFonts";
import { createTransformFields } from "./transformFields";
import { attachNumberDrag } from "./numberDrag";

export interface OverlayItem { image: string; label: string }
export type OverlayEntryKind = "border" | "background" | "icon" | "image" | "text";
/** One thing of an overlay as the overlay panel lists it. */
export interface OverlayEntry { id: string; kind: OverlayEntryKind; label: string; image?: string }
/** The ids of the two things of an overlay that are not elements. */
export const OVERLAY_BORDER = "border";
export const OVERLAY_BACKGROUND = "background";
/** The radius (px) of the cross on the selected element that removes it. */
const CROSS_RADIUS = 9;

/** How far outside the selection a press turns it (px of the frame), as in Photoshop: the pointer shows the curved arrows there. */
const ROTATE_RING = 26;
const cursors = new Map<number, string>();
/**
 * The cursor that turns a thing: two curved arrows around the thing's middle, as seen from the side of the pointer. It is drawn for the
 * direction (in steps of 15 degrees) the pointer is in, and kept.
 */
function rotateCursor(angle: number) {
  const step = ((Math.round(angle / 15) * 15) % 360 + 360) % 360;
  let cursor = cursors.get(step);
  if (!cursor) {
    const arc = "M5.500 9.500A8 8 0 0 1 18.500 9.500M5.500 9.500l-.2-3.600M5.500 9.500l3.600-.4M18.500 9.500l.2-3.600M18.500 9.500l-3.600-.4";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g transform="rotate(${step + 90} 12 12)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${arc}" stroke="#000" stroke-width="4.200"/><path d="${arc}" stroke="#fff" stroke-width="2"/></g></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
    cursors.set(step, cursor);
  }
  return cursor;
}

/** The element that was copied (Ctrl+C or the menu of the list): it is kept for the whole session, so it can be pasted into the overlay of another camera too. */
let clipboard: OverlayElement | null = null;

/** What an element and the background picture have in common: where they are, how big and how much they are turned. */
interface Placed { x: number; y: number; size: number; rotation: number }
/** A thing as a turned rectangle on the canvas: its middle, its own width and height, and its turn in degrees. */
interface Box { cx: number; cy: number; w: number; h: number; rotation: number }

const radians = (degrees: number) => degrees * Math.PI / 180;
/** A vector given in the axes of the canvas, in the axes of a thing that is turned by `rotation` (clockwise, the canvas's y runs down). */
function toLocal(dx: number, dy: number, rotation: number) {
  const a = -radians(rotation), c = Math.cos(a), s = Math.sin(a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
/** The other way round: a vector in the thing's own axes, in the axes of the canvas. */
function toWorld(lx: number, ly: number, rotation: number) {
  const a = radians(rotation), c = Math.cos(a), s = Math.sin(a);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}
const inside = (box: Box, x: number, y: number, margin = 0) => {
  const p = toLocal(x - box.cx, y - box.cy, box.rotation);
  return Math.abs(p.x) <= box.w / 2 + margin && Math.abs(p.y) <= box.h / 2 + margin;
};
/** The pointer is outside the box, but not further than the ring that turns it. */
const inRotateRing = (box: Box, x: number, y: number, pad: number) => {
  const p = toLocal(x - box.cx, y - box.cy, box.rotation);
  const out = Math.hypot(Math.max(0, Math.abs(p.x) - box.w / 2), Math.max(0, Math.abs(p.y) - box.h / 2));
  return out > pad && out <= pad + ROTATE_RING;
};
/** A point of the box given in half widths and half heights from its middle (1, 1 is the bottom right corner), on the canvas. */
const corner = (box: Box, fx: number, fy: number, extraX = 0, extraY = 0) => {
  const p = toWorld(fx * box.w / 2 + extraX, fy * box.h / 2 + extraY, box.rotation);
  return { x: box.cx + p.x, y: box.cy + p.y };
};

/**
 * The overlay of the camera that is looked through: its border, a picture behind the scene and the icons, pictures and texts over it. This is
 * the canvas over the frame that draws and edits them (clicks, drags, the preview of what is being placed), and the model the overlay panel
 * lists and the properties panel edits. Saved data and PNG rendering use the same camera-frame coordinates.
 *
 * Only the thing that is selected (in the panel, or by a click in the frame) can be moved or scaled with the mouse: a press on anything
 * else selects it, so that nothing is moved by accident.
 */
export class CameraOverlay {
  items: () => OverlayItem[] = () => [];
  private readonly canvas = document.createElement("canvas");
  /** Where the settings of the selection are drawn (the properties panel); set by `attachProperties`. */
  private properties: HTMLElement | null = null;
  /** The location, rotation and scale fields: the same block as the one of a character, a light or a camera. */
  private readonly transform;
  private readonly listeners = new Set<() => void>();
  private readonly fontLoads = new Map<string, Promise<void>>();
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly events = new AbortController();
  private camera: SceneCamera | null = null;
  private editing = false;
  private selected: string | null = null;
  private pending: "text" | OverlayItem | null = null;
  private hintText = "";
  /** Where the next element would be put (snapped), while one is being placed: a preview of it follows the pointer. */
  private hover: { x: number; y: number } | null = null;
  /** Moving the background picture: where the pointer and the picture were when it started. */
  private bgDrag: { pointer: number; x: number; y: number; ox: number; oy: number } | null = null;
  private drag: { pointer: number; x: number; y: number; original: OverlayElement; resize: boolean } | null = null;
  /** Turning the selected thing about its middle: the direction the pointer was in and the turn the thing had. */
  private spin: { pointer: number; start: number; original: number } | null = null;
  private signature = "";
  private width = 1;
  private height = 1;
  private disposed = false;

  constructor(private readonly rig: CameraRig, private readonly container: HTMLElement) {
    this.canvas.className = "cameraOverlayCanvas";
    container.append(this.canvas);
    this.transform = createTransformFields({
      position: ([x, y]) => this.edit(t => { const bg = t === this.camera?.overlay?.background; t.x = Math.max(bg ? -1 : 0, Math.min(bg ? 2 : 1, x / 100)); t.y = Math.max(bg ? -1 : 0, Math.min(bg ? 2 : 1, y / 100)); }),
      rotation: ([, , z]) => this.edit(t => { t.rotation = Math.max(-360, Math.min(360, z)); }),
      scale: (value) => this.edit(t => {
        const reference = this.reference(), now = t.size / reference;
        const next = value.find((v) => Math.abs(v - now) > 1e-6) ?? value[0];
        t.size = Math.max(.01, Math.min(t === this.camera?.overlay?.background ? 20 : 1, next * reference));
      }),
    }, { positionLabel: "Location (%)", positionTitle: "Place in the frame, in percent of its width and height", speed: { position: .25 } });
    const signal = this.events.signal;
    this.canvas.addEventListener("pointerdown", event => this.pointerDown(event), { signal });
    this.canvas.addEventListener("pointermove", event => this.pointerMove(event), { signal });
    this.canvas.addEventListener("dblclick", () => { if (this.editing && this.element()?.kind === "text") this.typeText(); }, { signal });
    this.canvas.addEventListener("pointerleave", () => { if (this.hover) { this.hover = null; this.signature = ""; } }, { signal });
    this.canvas.addEventListener("pointerup", event => this.endDrag(event.pointerId, true), { signal });
    this.canvas.addEventListener("pointercancel", event => this.endDrag(event.pointerId, false), { signal });
    this.canvas.addEventListener("lostpointercapture", event => this.endDrag(event.pointerId, false), { signal });
    // the wheel scales the selected thing
    this.canvas.addEventListener("wheel", event => {
      if (!this.editing) return;
      event.preventDefault(); event.stopPropagation();
      const thing = this.thing();
      if (thing) this.edit(t => { t.size = Math.max(.01, Math.min(t === this.camera?.overlay?.background ? 20 : 1, t.size * Math.exp(-event.deltaY * .001))); });
    }, { passive: false, signal });
    this.canvas.addEventListener("contextmenu", event => event.preventDefault(), { signal });
    window.addEventListener("keydown", event => {
      const target = event.target as HTMLElement | null;
      if (!this.editing || event.defaultPrevented || target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "v")) {
        const done = event.key.toLowerCase() === "c" ? this.copy() : this.paste();
        if (done) event.preventDefault();
      }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); this.removeSelected(); }
      else if (event.key === "Escape") {
        event.preventDefault();
        if (this.spin) this.endDrag(this.spin.pointer, false);
        else if (this.drag) this.endDrag(this.drag.pointer, false);
        else if (this.pending) this.setPending(null);
        else if (this.selected) this.select(null);
        else this.rig.stopOverlayEditing();
      }
    }, { signal });
  }

  // --- what the panels use ---------------------------------------------------------------------------------------------------

  /** Calls `fn` when what the panels show changes: the list of things, the selection, what is being placed, editing starting or ending. */
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }
  /** The overlay of the camera is being edited. */
  get isEditing() { return this.editing; }
  get selection() { return this.selected; }
  /** What the next click in the frame puts there ("text", or the label of an icon); null when nothing is being placed. */
  get placing() { return this.pending ? (this.pending === "text" ? "text" : this.pending.label) : null; }
  get hint() { return this.hintText; }
  private setHint(text: string) { if (text !== this.hintText) { this.hintText = text; this.emit(); } }

  /** The settings of the selection are drawn into `host` (and drawn again when the selection or the thing changes). */
  attachProperties(host: HTMLElement) { this.properties = host; this.showProperties(); }

  /** The things of the overlay, the one in front first (the way a layer list reads): border, elements from the last, the picture behind. */
  entries(): OverlayEntry[] {
    const data = this.camera?.overlay, out: OverlayEntry[] = [];
    if (data?.border) out.push({ id: OVERLAY_BORDER, kind: "border", label: "Border" });
    for (const e of [...(data?.elements ?? [])].reverse()) {
      if (e.kind === "icon") out.push({ id: e.id, kind: "icon", label: e.label, image: e.image });
      else if (e.kind === "image") out.push({ id: e.id, kind: "image", label: e.name });
      else out.push({ id: e.id, kind: "text", label: (e.text.split("\n")[0] || "Text").slice(0, 28) });
    }
    if (data?.background) out.push({ id: OVERLAY_BACKGROUND, kind: "background", label: data.background.name });
    return out;
  }

  select(id: string | null) {
    this.selected = id; this.signature = "";
    this.showProperties(); this.emit();
  }

  getGrid(): OverlayGrid { return { ...(this.camera?.overlay?.grid ?? DEFAULT_OVERLAY_GRID) }; }
  setGrid(grid: Partial<OverlayGrid>) {
    const data = this.data(); if (!data) return;
    const next = { ...(data.grid ?? DEFAULT_OVERLAY_GRID), ...grid };
    data.grid = { enabled: next.enabled, show: next.show, size: Math.max(.01, Math.min(.2, next.size)) };
    this.changed(); this.emit();
  }

  addBorder() {
    const data = this.data(); if (!data) return;
    this.setPending(null); data.border ??= { ...DEFAULT_BORDER };
    this.select(OVERLAY_BORDER); this.changed();
  }
  placeText() { this.setPending("text"); }
  placeIcon(item: OverlayItem) { this.setPending(item); }
  cancelPlacing() { this.setPending(null); }
  /** Asks for a picture on the disk and makes it the background (behind the scene, above the sky). */
  chooseBackground() { this.setPending(null); this.pickPicture(file => void this.importBackground(file)); }
  /** Asks for a picture on the disk and puts it in the frame as an element, in the order of the others. */
  chooseImage() { this.setPending(null); this.pickPicture(file => void this.importImage(file)); }
  remove(id: string) { this.select(id); this.removeSelected(); }

  /** Keeps a copy of the selected element (a text, an icon or a picture) to paste. */
  copy(): boolean {
    const e = this.element();
    if (!e || !this.editing) return false;
    clipboard = structuredClone(e);
    this.setHint(`Copied ${e.kind === "text" ? "the text" : e.kind === "icon" ? e.label : e.name}. Ctrl+V pastes it.`);
    return true;
  }
  /** There is something to paste, and an overlay to paste it into. */
  get canPaste() { return !!clipboard && this.editing; }
  /** Puts a copy of what was copied in the overlay, a step from the original so that it can be seen, and selects it (a text is ready to be typed). */
  paste(): boolean {
    const data = this.data();
    if (!data || !clipboard) return false;
    if (data.elements.length >= 200) { this.setHint("This camera already has 200 overlay elements. Remove one before pasting."); return true; }
    if (clipboard.kind === "image" && data.elements.filter(e => e.kind === "image").length >= MAX_OVERLAY_IMAGES) { this.setHint(`An overlay holds up to ${MAX_OVERLAY_IMAGES} pictures.`); return true; }
    const copy = structuredClone(clipboard);
    const grid = data.grid ?? DEFAULT_OVERLAY_GRID, aspect = this.width / this.height;
    // one cell of the grid down and to the right (a fixed step when it is off)
    const stepY = Math.max(.01, Math.min(.2, grid.size));
    copy.id = crypto.randomUUID();
    copy.x = Math.min(1, copy.x + (grid.enabled ? stepY / Math.max(.01, aspect) : .03));
    copy.y = Math.min(1, copy.y + (grid.enabled ? stepY : .03));
    data.elements.push(copy);
    // the next paste is a step further on, so that pasting again does not pile the copies on one place
    clipboard = structuredClone(copy);
    this.setPending(null);
    this.changed(); this.select(copy.id);
    if (copy.kind === "text") this.typeText();
    return true;
  }

  /** Puts an element in the list's order: above or below another one (the list reads front to back). */
  moveElement(id: string, targetId: string, above: boolean) {
    const data = this.data(); if (!data || id === targetId) return;
    const i = data.elements.findIndex(e => e.id === id); if (i < 0) return;
    const [moved] = data.elements.splice(i, 1);
    const at = data.elements.findIndex(e => e.id === targetId);
    if (at < 0) { data.elements.splice(i, 0, moved); return; }
    data.elements.splice(above ? at + 1 : at, 0, moved);
    this.changed(); this.emit();
  }
  /** In front of every other element, or behind all of them. */
  moveElementTo(id: string, where: "front" | "back") {
    const data = this.data(); if (!data) return;
    const i = data.elements.findIndex(e => e.id === id); if (i < 0) return;
    const [moved] = data.elements.splice(i, 1);
    if (where === "front") data.elements.push(moved); else data.elements.unshift(moved);
    this.changed(); this.emit();
  }

  // --- drawing ----------------------------------------------------------------------------------------------------------------

  update() {
    const camera = this.rig.activeCamera, editing = !!camera && this.rig.overlayEditing === camera.id;
    if (camera?.id !== this.camera?.id || editing !== this.editing) {
      this.endDrag(this.spin?.pointer ?? -1, false); this.endDrag(this.drag?.pointer ?? -1, false);
      this.selected = null; this.pending = null; this.hover = null; this.signature = "";
      this.hintText = editing ? "Pick something in the list, or click it in the frame. Only the selected one moves: drag it, a corner scales it, just outside it turns it (Shift: 15° steps). Alt bypasses the grid." : "";
      this.camera = camera; this.editing = editing;
      this.canvas.style.cursor = "";
      this.showProperties(); this.emit();
    }
    this.camera = camera; this.editing = editing;
    this.canvas.hidden = !camera;
    this.canvas.style.pointerEvents = editing ? "auto" : "none";
    if (!camera) return;
    const size = cameraSize(camera), frame = cameraFrame(this.container.clientWidth, this.container.clientHeight, size.w / size.h);
    this.width = Math.max(1, frame.w); this.height = Math.max(1, frame.h);
    // the picture of the frame is drawn at its own size and shown at the size of the shot on the screen (the view can be zoomed out of it)
    const z = this.rig.zoom, w = frame.w * z, h = frame.h * z;
    Object.assign(this.canvas.style, { left: `${(this.container.clientWidth - w) / 2 + this.rig.pan.x}px`, top: `${(this.container.clientHeight - h) / 2 + this.rig.pan.y}px`, width: `${w}px`, height: `${h}px` });
    const scale = Math.min(2, window.devicePixelRatio || 1);
    // (the data of the pictures is left out of what tells a redraw is needed: it would be written out every frame)
    const light = camera.overlay && { ...camera.overlay, background: camera.overlay.background && { ...camera.overlay.background, image: camera.overlay.background.image.length }, elements: camera.overlay.elements.map(e => e.kind === "image" ? { ...e, image: e.image.length } : e) };
    const signature = JSON.stringify([light, frame.w, frame.h, scale, this.selected, editing, this.pending && this.hover ? [this.hover, typeof this.pending === "string" ? this.pending : this.pending.image, this.images.has(typeof this.pending === "string" ? "" : this.pending.image)] : null]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.canvas.width = Math.max(1, Math.round(this.width * scale)); this.canvas.height = Math.max(1, Math.round(this.height * scale));
    const ctx = this.canvas.getContext("2d")!; ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const grid = camera.overlay?.grid ?? DEFAULT_OVERLAY_GRID;
    if (editing && grid.show) {
      const step = Math.max(.01, grid.size) * this.height;
      ctx.save(); ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = .16; ctx.lineWidth = .75; ctx.beginPath();
      for (let x = step; x < this.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
      for (let y = step; y < this.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
      ctx.stroke(); ctx.restore();
    }
    if (camera.overlay) {
      for (const e of camera.overlay.elements) { if (e.kind === "icon") void this.loadImage(e.image); else if (e.kind === "image") void this.loadPicture(e); }
      for (const e of camera.overlay.elements) if (e.kind === "text" && e.font) void this.loadFont(e.font);
      drawOverlay(ctx, camera.overlay, this.width, this.height, this.images);
      if (editing) for (const e of camera.overlay.elements) if (e.kind === "icon" && !this.images.has(e.image)) {
        const b = elementBounds(ctx, e, this.width, this.height);
        ctx.strokeStyle = accentHex(); ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.font = "12px 'Segoe UI'"; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText(this.failed.has(e.image) ? "Icon unavailable" : "Loading icon…", e.x * this.width, e.y * this.height);
      }
    }
    // the selection: a dashed outline turned with the thing, and for an element its scaling corner and the cross that removes it
    const box = editing && this.selected ? this.boxOf(this.selected, ctx) : null;
    if (box) {
      ctx.save(); ctx.translate(box.cx, box.cy); ctx.rotate(radians(box.rotation));
      const background = this.selected === OVERLAY_BACKGROUND;
      ctx.strokeStyle = "#ffe3b0"; ctx.lineWidth = background ? 2 : 1; ctx.setLineDash(background ? [8, 5] : [4, 3]); ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h); ctx.setLineDash([]);
      if (!background) { ctx.fillStyle = "#ffe3b0"; ctx.fillRect(box.w / 2 - 5, box.h / 2 - 5, 10, 10); }
      ctx.restore();
      if (!background) {
        const cross = this.crossOf(box);
        ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(cross.x, cross.y, CROSS_RADIUS, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.8; ctx.lineCap = "round"; ctx.beginPath();
        ctx.moveTo(cross.x - 3.5, cross.y - 3.5); ctx.lineTo(cross.x + 3.5, cross.y + 3.5); ctx.moveTo(cross.x + 3.5, cross.y - 3.5); ctx.lineTo(cross.x - 3.5, cross.y + 3.5); ctx.stroke();
      }
    }
    if (editing && this.pending) this.drawPlacing(ctx);
  }

  /** While an element is being placed: a preview of it where it would go, and a banner that says what a click does. */
  private drawPlacing(ctx: CanvasRenderingContext2D) {
    const pending = this.pending!, label = pending === "text" ? "text" : pending.label;
    if (this.hover) {
      const ghost: OverlayElement = pending === "text"
        ? { id: "preview", kind: "text", x: this.hover.x, y: this.hover.y, text: "Text", color: "#ffffff", bold: false, size: REFERENCE_SIZE.text, rotation: 0, opacity: .65 }
        : { id: "preview", kind: "icon", x: this.hover.x, y: this.hover.y, image: pending.image, label: pending.label, size: REFERENCE_SIZE.icon, rotation: 0, opacity: .65 };
      if (ghost.kind === "icon") void this.loadImage(ghost.image);
      drawOverlay(ctx, { elements: [ghost] }, this.width, this.height, this.images);
      const b = elementBounds(ctx, ghost, this.width, this.height);
      ctx.save(); ctx.strokeStyle = "#ffe3b0"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(this.hover.x * this.width - 7, this.hover.y * this.height); ctx.lineTo(this.hover.x * this.width + 7, this.hover.y * this.height);
      ctx.moveTo(this.hover.x * this.width, this.hover.y * this.height - 7); ctx.lineTo(this.hover.x * this.width, this.hover.y * this.height + 7); ctx.stroke(); ctx.restore();
    }
    const text = `Click to place ${label} · Esc cancels`;
    ctx.save(); ctx.font = "600 13px 'Segoe UI'"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 24, x = this.width / 2, y = 22;
    ctx.fillStyle = accentHex(); ctx.beginPath(); ctx.roundRect(x - w / 2, y - 12, w, 24, 12); ctx.fill();
    ctx.fillStyle = "#1b1206"; ctx.fillText(text, x, y); ctx.restore();
  }

  // --- the things of the frame as turned rectangles ------------------------------------------------------------------------------

  /** The selected thing (an element, or the background picture), or null. */
  private thing(): (Placed & { opacity: number }) | null {
    return this.element() ?? (this.selected === OVERLAY_BACKGROUND ? this.camera?.overlay?.background ?? null : null);
  }
  private element() { return this.camera?.overlay?.elements.find(e => e.id === this.selected); }
  /** The 1 of the scale of the selected thing: the size a new one of its kind has (for the background picture, the size that fills the frame). */
  private reference() {
    const e = this.element();
    if (e) return REFERENCE_SIZE[e.kind];
    const bg = this.camera?.overlay?.background;
    return bg ? Math.max(1, this.width / this.height / bg.aspect) : 1;
  }
  private boxOf(id: string, ctx: CanvasRenderingContext2D): Box | null {
    const data = this.camera?.overlay; if (!data) return null;
    if (id === OVERLAY_BACKGROUND) {
      const bg = data.background; if (!bg) return null;
      const h = bg.size * this.height;
      return { cx: bg.x * this.width, cy: bg.y * this.height, w: h * bg.aspect, h, rotation: bg.rotation ?? 0 };
    }
    const e = data.elements.find(x => x.id === id); if (!e) return null;
    return this.elementBox(ctx, e);
  }
  private elementBox(ctx: CanvasRenderingContext2D, e: OverlayElement): Box {
    const b = elementBounds(ctx, e, this.width, this.height);
    return { cx: e.x * this.width, cy: e.y * this.height, w: b.w, h: b.h, rotation: e.rotation ?? 0 };
  }
  /** The place of the cross that removes the selected element: past its top right corner. */
  private crossOf(box: Box) { return corner(box, 1, -1, 2, -2); }

  /** Starts (or, with null, ends) the placing of a new element: what is wanted shows in the panel, the cursor and the frame. */
  private setPending(value: "text" | OverlayItem | null) {
    this.pending = value; this.hover = null; this.signature = "";
    this.canvas.style.cursor = value ? "crosshair" : "";
    this.hintText = value ? `Placing ${value === "text" ? "text" : value.label}: click inside the camera frame. Esc cancels.` : this.hintText;
    this.emit();
  }

  /** Puts the cursor in the text of the selected text element, all of it selected, so that what is typed replaces it. */
  private typeText() {
    const field = this.properties?.querySelector<HTMLTextAreaElement>("textarea");
    if (!field) return;
    this.setHint("Type the text. Esc finishes typing.");
    field.focus(); field.select();
  }

  // --- data -------------------------------------------------------------------------------------------------------------------

  private data(): CameraOverlayData | null {
    if (!this.camera || !this.editing) return null;
    return this.camera.overlay ??= { elements: [], grid: { ...DEFAULT_OVERLAY_GRID } };
  }
  private changed() { this.signature = ""; this.syncTransform(); this.rig.onChange(); }
  /** Changes the selected thing (and shows it on the fields and in the frame). */
  private edit(change: (thing: Placed & { opacity: number }) => void) {
    const thing = this.thing(); if (!thing) return;
    change(thing);
    this.changed();
  }
  private async loadImage(path: string) {
    let pending = this.loading.get(path);
    if (!pending) {
      pending = (async () => {
        try {
          const url = await overlayItemIcon(path); if (!url) throw new Error("Missing item icon");
          const image = new Image(); image.src = url; await image.decode();
          if (!this.disposed) this.images.set(path, image);
        } catch { if (!this.disposed) this.failed.add(path); }
        this.signature = "";
      })();
      this.loading.set(path, pending);
    }
    await pending;
  }
  /** The picture of an image element (kept in the scene as a data URL), by the id of the element. */
  private async loadPicture(e: OverlayImage) {
    const key = `picture:${e.id}`;
    let pending = this.loading.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const image = new Image(); image.src = e.image; await image.decode();
          if (!this.disposed) this.images.set(e.id, image);
        } catch { if (!this.disposed) this.failed.add(e.id); }
        this.signature = "";
      })();
      this.loading.set(key, pending);
    }
    await pending;
  }
  async composite(ctx: CanvasRenderingContext2D, data: CameraOverlayData, width: number, height: number) {
    await Promise.all(data.elements.map(e => e.kind === "icon" ? this.loadImage(e.image) : e.kind === "image" ? this.loadPicture(e) : undefined));
    await Promise.all(data.elements.filter(e => e.kind === "text").map(e => ensureOverlayFont(e.font)));
    const missing = data.elements.find(e => (e.kind === "icon" && !this.images.has(e.image)) || (e.kind === "image" && !this.images.has(e.id)));
    if (missing) throw new Error(`Overlay picture unavailable: ${missing.kind === "icon" ? missing.label : missing.kind === "image" ? missing.name : "Item"}`);
    drawOverlay(ctx, data, width, height, this.images);
  }
  private loadFont(path: string) {
    let pending = this.fontLoads.get(path);
    if (!pending) {
      pending = ensureOverlayFont(path).then(() => { if (!this.disposed) this.signature = ""; })
        .catch(() => { this.fontLoads.delete(path); if (!this.disposed) this.setHint("Selected game font unavailable. Reindex TF2 or choose another font."); });
      this.fontLoads.set(path, pending);
    }
    return pending;
  }

  // --- the frame ---------------------------------------------------------------------------------------------------------------

  private point(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }
  private pointerDown(event: PointerEvent) {
    if (!this.editing || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    // the keys (Esc, Delete, Ctrl+C) are the frame's again, not those of a field that was being typed in
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) focused.blur();
    const data = this.data()!, point = this.point(event), px = point.x * this.width, py = point.y * this.height;
    const ctx = this.canvas.getContext("2d")!;
    if (this.pending) {
      if (data.elements.length >= 200) { this.setHint("This camera already has 200 overlay elements. Remove one before adding another."); return; }
      const placed = { id: crypto.randomUUID(), ...snapOverlayPoint(point.x, point.y, this.width / this.height, data.grid ?? DEFAULT_OVERLAY_GRID, event.altKey), rotation: 0, opacity: 1 };
      const element: OverlayElement = this.pending === "text" ? { ...placed, kind: "text", text: "Text", color: "#ffffff", bold: false, size: REFERENCE_SIZE.text } : { ...placed, kind: "icon", image: this.pending.image, label: this.pending.label, size: REFERENCE_SIZE.icon };
      data.elements.push(element); this.pending = null; this.hover = null; this.canvas.style.cursor = "";
      this.changed(); this.select(element.id);
      if (element.kind === "text") this.typeText();
      return;
    }
    // the selected thing is the only one a press can move: the cross removes it, a corner scales it, anywhere on it moves it
    const current = this.element(), box = this.selected ? this.boxOf(this.selected, ctx) : null;
    if (box && current) {
      const cross = this.crossOf(box);
      if (Math.hypot(px - cross.x, py - cross.y) <= CROSS_RADIUS + 3) { this.removeSelected(); return; }
    }
    if (box && inside(box, px, py, current ? 6 : 0)) {
      if (current) {
        const handle = corner(box, 1, 1);
        this.drag = { pointer: event.pointerId, ...point, original: { ...current }, resize: Math.hypot(px - handle.x, py - handle.y) < 14 };
      } else {
        const picture = data.background!;
        this.bgDrag = { pointer: event.pointerId, x: point.x, y: point.y, ox: picture.x, oy: picture.y };
      }
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    // just outside the selection, a press turns it about its middle
    if (box && inRotateRing(box, px, py, current ? 6 : 0)) {
      this.spin = { pointer: event.pointerId, start: Math.atan2(py - box.cy, px - box.cx), original: this.thing()?.rotation ?? 0 };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    // a press on anything else only selects it (the topmost element under the pointer), or selects nothing
    const hit = [...data.elements].reverse().find(e => inside(this.elementBox(ctx, e), px, py, 6));
    this.select(hit?.id ?? null);
  }
  /** Without a drag: the preview of a new element follows the pointer, and the cursor says what a press would do. */
  private hoverAt(event: PointerEvent) {
    const point = this.point(event), data = this.data();
    if (this.pending && data) {
      const next = snapOverlayPoint(point.x, point.y, this.width / this.height, data.grid ?? DEFAULT_OVERLAY_GRID, event.altKey);
      if (!this.hover || this.hover.x !== next.x || this.hover.y !== next.y) { this.hover = next; this.signature = ""; }
      return;
    }
    const ctx = this.canvas.getContext("2d")!, box = this.selected ? this.boxOf(this.selected, ctx) : null;
    const x = point.x * this.width, y = point.y * this.height;
    let cursor = "";
    if (box) {
      const element = !!this.element();
      const cross = this.crossOf(box), handle = corner(box, 1, 1);
      if (element && Math.hypot(x - cross.x, y - cross.y) <= CROSS_RADIUS + 3) cursor = "pointer";
      else if (element && Math.hypot(x - handle.x, y - handle.y) < 14) cursor = "nwse-resize";
      else if (inside(box, x, y, element ? 6 : 0)) cursor = "move";
      else if (inRotateRing(box, x, y, element ? 6 : 0)) cursor = rotateCursor(Math.atan2(y - box.cy, x - box.cx) * 180 / Math.PI);
    }
    this.canvas.style.cursor = cursor;
  }
  private pointerMove(event: PointerEvent) {
    const turning = this.spin, thing = this.thing();
    if (turning && thing && turning.pointer === event.pointerId) {
      event.preventDefault(); event.stopPropagation();
      const box = this.boxOf(this.selected!, this.canvas.getContext("2d")!), at = this.point(event);
      if (box) {
        const now = Math.atan2(at.y * this.height - box.cy, at.x * this.width - box.cx);
        let turn = turning.original + (now - turning.start) * 180 / Math.PI;
        // Shift turns in steps of 15 degrees
        if (event.shiftKey) turn = Math.round(turn / 15) * 15;
        thing.rotation = ((turn + 540) % 360 + 360) % 360 - 180;
        this.canvas.style.cursor = rotateCursor(now * 180 / Math.PI);
        this.changed();
      }
      return;
    }
    const moving = this.bgDrag, picture = this.camera?.overlay?.background;
    if (moving && picture && moving.pointer === event.pointerId) {
      event.preventDefault(); event.stopPropagation(); const at = this.point(event);
      picture.x = Math.max(-1, Math.min(2, moving.ox + at.x - moving.x)); picture.y = Math.max(-1, Math.min(2, moving.oy + at.y - moving.y));
      this.changed(); return;
    }
    if (this.editing && !this.drag && !this.bgDrag && !this.spin) this.hoverAt(event);
    const drag = this.drag, element = this.element(); if (!drag || !element || drag.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); const point = this.point(event);
    if (drag.resize) {
      // the pull on the corner is measured along the axes of the element, so that a turned one scales as it looks
      const pull = toLocal((point.x - drag.x) * this.width, (point.y - drag.y) * this.height, element.rotation ?? 0);
      const size = Math.max(.01, Math.min(1, drag.original.size * Math.exp((pull.x + pull.y) / this.height * 2)));
      // the size takes the steps of the grid, as the place does (Alt goes round it): an icon in whole steps, a text in half steps, which suit letters
      const grid = this.camera?.overlay?.grid ?? DEFAULT_OVERLAY_GRID, step = Math.max(.01, Math.min(.2, grid.size)) / (element.kind === "text" ? 2 : 1);
      element.size = grid.enabled && !event.altKey ? Math.max(step, Math.min(1, Math.round(size / step) * step)) : size;
    }
    else Object.assign(element, snapOverlayPoint(drag.original.x + point.x - drag.x, drag.original.y + point.y - drag.y, this.width / this.height, this.camera?.overlay?.grid ?? DEFAULT_OVERLAY_GRID, event.altKey));
    this.changed();
  }
  private endDrag(pointer: number, confirm: boolean) {
    if (this.spin?.pointer === pointer) {
      const turned = this.spin; this.spin = null;
      const thing = this.thing();
      if (!confirm && thing) thing.rotation = turned.original;
      if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
      this.changed();
      return;
    }
    if (this.bgDrag?.pointer === pointer) {
      const moved = this.bgDrag; this.bgDrag = null;
      const picture = this.camera?.overlay?.background;
      if (!confirm && picture) { picture.x = moved.ox; picture.y = moved.oy; }
      if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
      this.changed();
      return;
    }
    if (!this.drag || this.drag.pointer !== pointer) return;
    const drag = this.drag; this.drag = null;
    const element = this.element(); if (!confirm && element) Object.assign(element, drag.original);
    if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.changed();
  }
  private removeSelected() {
    const data = this.data(); if (!data || !this.selected) return;
    if (this.selected === OVERLAY_BACKGROUND) delete data.background;
    else if (this.selected === OVERLAY_BORDER) delete data.border;
    else data.elements = data.elements.filter(e => e.id !== this.selected);
    this.selected = null; this.changed(); this.showProperties(); this.emit();
  }

  // --- pictures of the user's own ---------------------------------------------------------------------------------------------

  private pickPicture(then: (file: File) => void) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => { const file = input.files?.[0]; if (file) then(file); };
    input.click();
  }

  /** Reads a picture from the disk and scales it down (the scene keeps it, so it is kept small). */
  private async readPicture(file: File): Promise<{ url: string; aspect: number }> {
    this.setHint(`Reading ${file.name}…`);
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width, height = bitmap.height;
    let url = "";
    // as sharp as fits: a big picture is scaled down, and made smaller still when it would be too much for the scene file
    for (const [type, quality, limit] of [["image/webp", .92, 2048], ["image/webp", .85, 1600], ["image/jpeg", .8, 1280]] as const) {
      const scale = Math.min(1, limit / Math.max(width, height));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const made = canvas.toDataURL(type, quality);
      if (made.startsWith(`data:${type}`) && made.length <= MAX_BACKGROUND_CHARS) { url = made; break; }
    }
    bitmap.close?.();
    if (!url) throw new Error("it is too big");
    return { url, aspect: width / height };
  }

  private async importBackground(file: File) {
    const data = this.data(); if (!data) return;
    try {
      const { url, aspect } = await this.readPicture(file);
      const frameAspect = this.width / this.height;
      data.background = { image: url, name: file.name.slice(0, 120), aspect, x: .5, y: .5, size: Math.max(1, frameAspect / aspect), rotation: 0, opacity: 1 };
      this.hintText = "The picture is behind the scene. Drag it to move it while it is selected; the wheel scales it.";
      this.changed(); this.select(OVERLAY_BACKGROUND);
    } catch (error) {
      this.setHint(`That picture could not be used: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async importImage(file: File) {
    const data = this.data(); if (!data) return;
    if (data.elements.filter(e => e.kind === "image").length >= MAX_OVERLAY_IMAGES) { this.setHint(`An overlay holds up to ${MAX_OVERLAY_IMAGES} pictures.`); return; }
    try {
      const { url, aspect } = await this.readPicture(file);
      const middle = snapOverlayPoint(.5, .5, this.width / this.height, data.grid ?? DEFAULT_OVERLAY_GRID);
      const element: OverlayImage = { id: crypto.randomUUID(), kind: "image", image: url, name: file.name.slice(0, 120), aspect, ...middle, size: REFERENCE_SIZE.image, rotation: 0, opacity: 1 };
      data.elements.push(element);
      this.hintText = "Drag the picture to move it while it is selected; a corner scales it.";
      this.changed(); this.select(element.id);
    } catch (error) {
      this.setHint(`That picture could not be used: ${error instanceof Error ? error.message : error}`);
    }
  }

  // --- the settings of the selection (drawn into the properties panel) ----------------------------------------------------------

  private addInput(parent: HTMLElement, label: string, type: string, value: string, change: (input: HTMLInputElement) => void, min?: string, max?: string) {
    const row = document.createElement("label"); row.textContent = label;
    const input = document.createElement("input"); input.type = type; input.value = value;
    input.setAttribute("aria-label", label); if (min) input.min = min; if (max) input.max = max; input.step = ".1";
    input.oninput = () => { if (type === "number" && !Number.isFinite(input.valueAsNumber)) return; change(input); this.changed(); };
    row.append(input); parent.append(row);
    // a number is typed (a click) or scrubbed (a drag sideways, Shift finer), like the fields of the camera and of the other things
    if (type === "number") {
      row.classList.add("scrubRow");
      const lo = min === undefined ? -Infinity : +min, hi = max === undefined ? Infinity : +max;
      const speed = Number.isFinite(hi - lo) ? Math.max(.01, (hi - lo) / 400) : .1;
      attachNumberDrag(input, speed, {
        start() {},
        change: value => { input.value = String(+Math.max(lo, Math.min(hi, value)).toFixed(2)); change(input); this.changed(); },
        end() {},
      });
    }
    return input;
  }
  private button(parent: HTMLElement, label: string, action: () => void) {
    const button = document.createElement("button"); button.textContent = label; button.onclick = action; parent.append(button); return button;
  }
  private title(parent: HTMLElement, text: string) { const b = document.createElement("b"); b.textContent = text; parent.append(b); }

  /** Puts the location, rotation and scale of the selected thing on the fields (the place is in percent of the frame, the scale is 1 at the size a new one has). */
  private syncTransform() {
    const thing = this.thing();
    if (!thing) { this.transform.set({ position: null, rotation: null, scale: null }); return; }
    const scale = thing.size / this.reference();
    this.transform.set({
      position: [thing.x * 100, thing.y * 100, 0], positionAxes: [true, true, false],
      rotation: [0, 0, thing.rotation ?? 0], rotationAxes: [false, false, true],
      scale: [scale, scale, 1], scaleAxes: [true, true, false],
    });
  }

  private showProperties() {
    const host = this.properties; if (!host) return;
    host.replaceChildren();
    if (!this.editing) return;
    const data = this.camera?.overlay;
    if (this.selected === OVERLAY_BORDER && data?.border) return this.borderProperties(host, data.border);
    if (this.selected === OVERLAY_BACKGROUND && data?.background) return this.backgroundProperties(host, data.background);
    const element = this.element();
    if (!element) {
      const note = document.createElement("p"); note.className = "dim hint"; note.textContent = "Nothing is selected. Pick an entry of the Overlay panel or click something in the frame.";
      host.append(note); return;
    }
    this.title(host, element.kind === "icon" ? element.label : element.kind === "image" ? element.name : "Text");
    host.append(this.transform.el); this.syncTransform();
    if (element.kind === "text") {
      const text = document.createElement("textarea"); text.value = element.text; text.maxLength = 2000; text.setAttribute("aria-label", "Overlay text");
      text.oninput = () => { element.text = text.value; this.changed(); this.emit(); };
      text.onkeydown = event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); text.blur(); this.setHint("Drag it to move it while it is selected; a corner scales. Alt bypasses the grid."); } };
      host.append(text);
      this.addInput(host, "Colour", "color", element.color, input => { element.color = input.value; });
      const bold = this.addInput(host, "Bold", "checkbox", "", input => { element.bold = input.checked; }); bold.checked = element.bold;
      const fontRow = document.createElement("label"); fontRow.textContent = "Font";
      const font = document.createElement("select"); font.setAttribute("aria-label", "Overlay font");
      for (const face of OVERLAY_FONTS) { const option = document.createElement("option"); option.value = face.path; option.textContent = face.label; font.append(option); }
      font.value = element.font ?? "";
      font.onchange = () => { if (font.value) element.font = font.value; else delete element.font; this.changed(); };
      fontRow.append(font); host.append(fontRow);
    }
    if (element.kind === "text") this.textModifiers(host, element);
    this.addInput(host, "Opacity (%)", "number", String(element.opacity * 100), input => { element.opacity = Math.max(0, Math.min(1, input.valueAsNumber / 100)); }, "0", "100");
    this.button(host, "Remove", () => this.removeSelected());
  }

  /** The outline, glow and drop shadow of a text: each is switched on, and then has its colour and its sizes (in percent of the size of the text). */
  private textModifiers(host: HTMLElement, text: OverlayText) {
    const percent = (value: number) => String(+(value * 100).toFixed(1));
    const group = <K extends "outline" | "glow" | "shadow">(key: K, label: string, defaults: NonNullable<OverlayText[K]>, fields: (box: HTMLElement, value: NonNullable<OverlayText[K]>) => void) => {
      const box = document.createElement("div"); box.className = "overlayModifier";
      const on = this.addInput(box, label, "checkbox", "", input => {
        const current = text[key] as NonNullable<OverlayText[K]> | undefined;
        (text as unknown as Record<string, unknown>)[key] = { ...(current ?? defaults), enabled: input.checked };
        this.showProperties();
      });
      on.checked = text[key]?.enabled === true;
      if (on.checked) fields(box, text[key] as NonNullable<OverlayText[K]>);
      host.append(box);
    };
    group("outline", "Outline", DEFAULT_TEXT_OUTLINE, (box, v) => {
      this.addInput(box, "Colour", "color", v.color, input => { v.color = input.value; });
      this.addInput(box, "Width (% of text)", "number", percent(v.width), input => { v.width = Math.max(0, Math.min(.4, input.valueAsNumber / 100)); }, "0", "40");
    });
    group("glow", "Glow", DEFAULT_TEXT_GLOW, (box, v) => {
      this.addInput(box, "Colour", "color", v.color, input => { v.color = input.value; });
      this.addInput(box, "Size (% of text)", "number", percent(v.size), input => { v.size = Math.max(0, Math.min(2, input.valueAsNumber / 100)); }, "0", "200");
    });
    group("shadow", "Drop shadow", DEFAULT_TEXT_SHADOW, (box, v) => {
      this.addInput(box, "Colour", "color", v.color, input => { v.color = input.value; });
      this.addInput(box, "Across (% of text)", "number", percent(v.x), input => { v.x = Math.max(-1, Math.min(1, input.valueAsNumber / 100)); }, "-100", "100");
      this.addInput(box, "Down (% of text)", "number", percent(v.y), input => { v.y = Math.max(-1, Math.min(1, input.valueAsNumber / 100)); }, "-100", "100");
      this.addInput(box, "Blur (% of text)", "number", percent(v.blur), input => { v.blur = Math.max(0, Math.min(1, input.valueAsNumber / 100)); }, "0", "100");
    });
  }

  private borderProperties(host: HTMLElement, border: NonNullable<CameraOverlayData["border"]>) {
    const data = this.data(); if (!data) return;
    this.title(host, "Border");
    const presetRow = document.createElement("label"); presetRow.textContent = "Preset";
    const preset = document.createElement("select"); preset.setAttribute("aria-label", "Border preset");
    const custom = document.createElement("option"); custom.value = ""; custom.textContent = "Custom"; preset.append(custom);
    BORDER_PRESETS.forEach((p, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = p.name; preset.append(option); });
    const index = BORDER_PRESETS.findIndex(p => JSON.stringify(p.border) === JSON.stringify(border)); preset.value = index < 0 ? "" : String(index);
    preset.onchange = () => { if (preset.value === "") return; data.border = { ...BORDER_PRESETS[+preset.value].border }; this.changed(); this.showProperties(); };
    presetRow.append(preset); host.append(presetRow);
    this.addInput(host, "Colour", "color", border.color, input => { border.color = input.value; });
    for (const [key, label, max] of [["width", "Width (% height)", 10], ["inset", "Inset (% height)", 25], ["radius", "Corners (% height)", 25], ["opacity", "Opacity (%)", 100]] as const) {
      this.addInput(host, label, "number", String(border[key] * 100), input => { border[key] = Math.max(key === "width" ? .001 : 0, Math.min(max / 100, input.valueAsNumber / 100)); }, key === "width" ? ".1" : "0", String(max));
    }
    // a film frame can have a chin at the bottom (a polaroid)
    if (border.style === "frame") this.addInput(host, "Chin (% height)", "number", String(+((border.chin ?? 0) * 100).toFixed(2)), input => { const v = Math.max(0, Math.min(.3, input.valueAsNumber / 100)); if (v > 0) border.chin = v; else delete border.chin; }, "0", "30");
    this.button(host, "Remove", () => this.removeSelected());
  }

  private backgroundProperties(host: HTMLElement, bg: OverlayBackground) {
    this.title(host, `Background: ${bg.name}`);
    host.append(this.transform.el); this.syncTransform();
    this.addInput(host, "Opacity (%)", "number", String(+(bg.opacity * 100).toFixed(1)), input => { bg.opacity = Math.max(0, Math.min(1, input.valueAsNumber / 100)); }, "0", "100");
    const frameAspect = this.width / this.height;
    for (const [label, size] of [["Fill the frame", Math.max(1, frameAspect / bg.aspect)], ["Fit the whole picture", Math.min(1, frameAspect / bg.aspect)]] as const) {
      this.button(host, label, () => { bg.size = size; bg.x = .5; bg.y = .5; bg.rotation = 0; this.changed(); });
    }
    this.button(host, "Choose another picture…", () => this.pickPicture(file => void this.importBackground(file)));
    this.button(host, "Remove", () => this.removeSelected());
  }

  dispose() { this.disposed = true; this.events.abort(); this.canvas.remove(); this.listeners.clear(); this.images.clear(); this.loading.clear(); }
}
