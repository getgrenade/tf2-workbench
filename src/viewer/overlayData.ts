import { overlayFontFamily, validOverlayFont } from "./overlayFonts";

/** `chin` (the "frame" style only) is extra border at the bottom, as a fraction of the frame's height: a polaroid. */
export interface OverlayBorder { color: string; opacity: number; width: number; inset: number; radius: number; style?: "solid" | "double" | "corners" | "cinema" | "frame"; chin?: number }
/** Where an element is: x and y are its middle and size its height, as fractions of the frame's height; rotation is in degrees, turning clockwise. */
interface PlacedOverlay { id: string; x: number; y: number; size: number; rotation: number; opacity: number }
export interface OverlayIcon extends PlacedOverlay { kind: "icon"; image: string; label: string }
/**
 * The modifiers of a text. Their sizes are fractions of the size of the text, so that they grow and shrink with it.
 * An outline of `width` reaches that far out of the letters, a glow spreads `size` from them, a drop shadow is `x`, `y` away, and blurred by `blur`.
 */
export interface TextOutline { enabled: boolean; color: string; width: number }
export interface TextGlow { enabled: boolean; color: string; size: number }
export interface TextShadow { enabled: boolean; color: string; x: number; y: number; blur: number }
export const DEFAULT_TEXT_OUTLINE: TextOutline = { enabled: true, color: "#000000", width: .08 };
export const DEFAULT_TEXT_GLOW: TextGlow = { enabled: true, color: "#ffd479", size: .4 };
export const DEFAULT_TEXT_SHADOW: TextShadow = { enabled: true, color: "#000000", x: .06, y: .06, blur: .12 };
export interface OverlayText extends PlacedOverlay { kind: "text"; text: string; color: string; bold: boolean; font?: string; outline?: TextOutline; glow?: TextGlow; shadow?: TextShadow }
/** A picture of the user's own over the scene, in the order of the other elements (a background picture is the one that is behind the scene). */
export interface OverlayImage extends PlacedOverlay { kind: "image"; image: string; name: string; aspect: number }
export type OverlayElement = OverlayIcon | OverlayText | OverlayImage;
/** The size (height, as a fraction of the frame's) that a new element of a kind has: the 1 of its scale. */
export const REFERENCE_SIZE = { icon: .3, text: .045, image: .4 } as const;
/** How many pictures of the user's own an overlay may hold (each is kept in the scene file). */
export const MAX_OVERLAY_IMAGES = 24;
/**
 * A picture of the user's own behind the scene (above the sky). It is kept in the scene as a data URL, scaled down when it was picked, and
 * placed like the elements: x and y are where its middle is in the frame, size is its height, both as fractions of the frame's height.
 */
export interface OverlayBackground { image: string; name: string; aspect: number; x: number; y: number; size: number; rotation: number; opacity: number }
/** Whether a string is a picture kept in the scene (a data URL of a kind that is made when one is picked, and not too big). */
export const isPictureData = (v: unknown): v is string => typeof v === "string" && v.length <= 14_000_000 && /^data:image\/(webp|png|jpeg);base64,/.test(v.slice(0, 40));
/** The most characters a picture may have as a data URL (a few megabytes of picture). */
export const MAX_BACKGROUND_CHARS = 14_000_000;
export interface OverlayGrid { enabled: boolean; show: boolean; size: number }
export interface CameraOverlayData { border?: OverlayBorder; background?: OverlayBackground; elements: OverlayElement[]; grid?: OverlayGrid }
export const DEFAULT_BORDER: OverlayBorder = { color: "#ffffff", opacity: 1, width: .006, inset: .01, radius: .02 };
export const DEFAULT_OVERLAY_GRID: OverlayGrid = { enabled: true, show: true, size: .05 };
export const BORDER_PRESETS: { name: string; border: OverlayBorder }[] = [
  { name: "Thin", border: { ...DEFAULT_BORDER, width: .002, inset: .015, radius: 0 } },
  { name: "Bold", border: { ...DEFAULT_BORDER, width: .015, radius: .015 } },
  { name: "Double", border: { ...DEFAULT_BORDER, width: .003, inset: .02, radius: 0, style: "double" } },
  { name: "Corner brackets", border: { ...DEFAULT_BORDER, color: "#ffffff", width: .005, inset: .025, radius: 0, style: "corners" } },
  { name: "Cinema bars", border: { ...DEFAULT_BORDER, color: "#000000", width: .08, inset: 0, radius: 0, style: "cinema" } },
  { name: "Film print", border: { ...DEFAULT_BORDER, color: "#f4f1ea", width: .04, inset: 0, radius: 0, style: "frame" } },
  { name: "Polaroid", border: { ...DEFAULT_BORDER, color: "#f4f1ea", width: .04, inset: 0, radius: .012, style: "frame", chin: .12 } },
];
export function snapOverlayPoint(x: number, y: number, aspect: number, grid: OverlayGrid, bypass = false) {
  const stepY = Math.max(.01, Math.min(.2, grid.size)), stepX = stepY / Math.max(.01, aspect);
  const snap = (v: number, step: number) => Math.max(0, Math.min(1, grid.enabled && !bypass ? Math.round(v / step) * step : v));
  return { x: snap(x, stepX), y: snap(y, stepY) };
}
export const overlayColor = (value: unknown, fallback = "#ffffff") => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
/** Validate and detach scene data; store material paths rather than decoded image bytes. */
export function parseOverlay(raw: unknown): CameraOverlayData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Partial<CameraOverlayData>, result: CameraOverlayData = { elements: [] };
  if (input.grid && typeof input.grid === "object") result.grid = { enabled: input.grid.enabled === true, show: input.grid.show === true, size: number(input.grid.size, .05, .01, .2) };
  if (input.border && typeof input.border === "object") {
    const b = input.border;
    result.border = { color: overlayColor(b.color, DEFAULT_BORDER.color), opacity: number(b.opacity, 1, 0, 1), width: number(b.width, .006, .001, .1), inset: number(b.inset, .01, 0, .25), radius: number(b.radius, .02, 0, .25) };
    if (b.style && ["solid", "double", "corners", "cinema", "frame"].includes(b.style)) result.border.style = b.style;
    if (result.border.style === "frame" && typeof b.chin === "number" && Number.isFinite(b.chin) && b.chin > 0) result.border.chin = Math.min(.3, b.chin);
  }
  const bg = input.background as Partial<OverlayBackground> | undefined;
  if (bg && typeof bg === "object" && isPictureData(bg.image)) {
    result.background = { image: bg.image, name: typeof bg.name === "string" ? bg.name.slice(0, 120) : "Picture", aspect: number(bg.aspect, 1, .05, 20), x: number(bg.x, .5, -1, 2), y: number(bg.y, .5, -1, 2), size: number(bg.size, 1, .02, 20), rotation: number(bg.rotation, 0, -360, 360), opacity: number(bg.opacity, 1, 0, 1) };
  }
  let pictures = 0;
  const ids = new Set<string>();
  for (const e of Array.isArray(input.elements) ? input.elements.slice(0, 200) : []) {
    if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id)) continue;
    const placed = { id: e.id, x: number(e.x, .5, 0, 1), y: number(e.y, .5, 0, 1), size: number(e.size, e.kind === "icon" ? .18 : .045, .01, 1), rotation: number(e.rotation, 0, -360, 360), opacity: number(e.opacity, 1, 0, 1) };
    if (e.kind === "icon" && typeof e.image === "string" && /^[\w\-/ ]+$/.test(e.image) && !e.image.includes("..")) {
      result.elements.push({ ...placed, kind: "icon", image: e.image, label: typeof e.label === "string" ? e.label.slice(0, 200) : "Item" });
    } else if (e.kind === "image" && isPictureData(e.image) && pictures < MAX_OVERLAY_IMAGES) {
      pictures++;
      result.elements.push({ ...placed, kind: "image", image: e.image, name: typeof e.name === "string" ? e.name.slice(0, 120) : "Picture", aspect: number(e.aspect, 1, .05, 20) });
    } else if (e.kind === "text" && typeof e.text === "string") {
      const text: OverlayText = { ...placed, kind: "text", text: e.text.slice(0, 2000), color: overlayColor(e.color), bold: e.bold === true, ...(e.font && validOverlayFont(e.font) ? { font: e.font } : {}) };
      const o = e.outline, g = e.glow, s = e.shadow;
      if (o && typeof o === "object") text.outline = { enabled: o.enabled === true, color: overlayColor(o.color, DEFAULT_TEXT_OUTLINE.color), width: number(o.width, DEFAULT_TEXT_OUTLINE.width, 0, .4) };
      if (g && typeof g === "object") text.glow = { enabled: g.enabled === true, color: overlayColor(g.color, DEFAULT_TEXT_GLOW.color), size: number(g.size, DEFAULT_TEXT_GLOW.size, 0, 2) };
      if (s && typeof s === "object") text.shadow = { enabled: s.enabled === true, color: overlayColor(s.color, DEFAULT_TEXT_SHADOW.color), x: number(s.x, DEFAULT_TEXT_SHADOW.x, -1, 1), y: number(s.y, DEFAULT_TEXT_SHADOW.y, -1, 1), blur: number(s.blur, DEFAULT_TEXT_SHADOW.blur, 0, 1) };
      result.elements.push(text);
    } else continue;
    ids.add(e.id);
  }
  return result;
}
export function elementBounds(ctx: CanvasRenderingContext2D, e: OverlayElement, width: number, height: number) {
  const size = e.size * height;
  if (e.kind === "icon") return { x: e.x * width - size / 2, y: e.y * height - size / 2, w: size, h: size };
  if (e.kind === "image") return { x: e.x * width - size * e.aspect / 2, y: e.y * height - size / 2, w: size * e.aspect, h: size };
  ctx.font = `${e.bold ? "bold " : ""}${size}px ${overlayFontFamily(e.font)}`;
  const lines = e.text.split("\n"), w = Math.max(size / 2, ...lines.map(line => ctx.measureText(line).width));
  const h = Math.max(1, lines.length) * size * 1.2;
  return { x: e.x * width - w / 2, y: e.y * height - h / 2, w, h };
}
/**
 * A text with its modifiers, from the back to the front: the drop shadow, the glow, the outline, the letters. The blur and the offset of a
 * canvas shadow are in pixels of the picture whatever the transform is, so they are scaled by it, and the shadow keeps its direction on the
 * screen when the text is turned.
 */
function drawText(ctx: CanvasRenderingContext2D, e: OverlayText, rect: { x: number; y: number }, height: number) {
  const fontSize = e.size * height, lines = e.text.split("\n");
  const t = ctx.getTransform(), scale = Math.hypot(t.a, t.b) || 1;
  const each = (draw: (line: string, x: number, y: number) => void) => lines.forEach((line, index) => draw(line, rect.x, rect.y + index * fontSize * 1.2));
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
  if (e.shadow?.enabled) {
    ctx.save();
    ctx.shadowColor = e.shadow.color; ctx.shadowOffsetX = e.shadow.x * fontSize * scale; ctx.shadowOffsetY = e.shadow.y * fontSize * scale; ctx.shadowBlur = e.shadow.blur * fontSize * scale;
    ctx.fillStyle = e.color; each((line, x, y) => ctx.fillText(line, x, y));
    ctx.restore();
  }
  if (e.glow?.enabled) {
    // twice, so that it is as strong as a glow is expected to be
    ctx.save();
    ctx.shadowColor = e.glow.color; ctx.shadowBlur = e.glow.size * fontSize * scale; ctx.fillStyle = e.glow.color;
    for (let pass = 0; pass < 2; pass++) each((line, x, y) => ctx.fillText(line, x, y));
    ctx.restore();
  }
  if (e.outline?.enabled && e.outline.width > 0) {
    // the stroke is centred on the edge of the letters and the letters go over its inner half, so it reaches `width` out
    ctx.save(); ctx.strokeStyle = e.outline.color; ctx.lineWidth = e.outline.width * fontSize * 2;
    each((line, x, y) => ctx.strokeText(line, x, y));
    ctx.restore();
  }
  ctx.fillStyle = e.color;
  each((line, x, y) => ctx.fillText(line, x, y));
}
/** One renderer for the live camera overlay and final PNG, with all dimensions relative to frame height. */
export function drawOverlay(ctx: CanvasRenderingContext2D, data: CameraOverlayData, width: number, height: number, images: ReadonlyMap<string, CanvasImageSource>) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  for (const e of data.elements) {
    ctx.globalAlpha = e.opacity;
    const bounds = elementBounds(ctx, e, width, height);
    // an element is drawn around its middle, turned by its rotation
    const cx = e.x * width, cy = e.y * height;
    const rect = { x: bounds.x - cx, y: bounds.y - cy, w: bounds.w, h: bounds.h };
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((e.rotation ?? 0) * Math.PI / 180);
    if (e.kind === "icon" || e.kind === "image") {
      const image = images.get(e.kind === "image" ? e.id : e.image);
      if (image) {
        const dimensions = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
        const w = dimensions.naturalWidth || dimensions.width || 1, h = dimensions.naturalHeight || dimensions.height || 1;
        const scale = Math.min(rect.w / w, rect.h / h), fitW = w * scale, fitH = h * scale;
        ctx.drawImage(image, rect.x + (rect.w - fitW) / 2, rect.y + (rect.h - fitH) / 2, fitW, fitH);
      }
    } else {
      drawText(ctx, e, rect, height);
    }
    ctx.restore();
  }
  if (data.border) {
    const b = data.border, line = b.width * height, inset = b.inset * height + line / 2;
    ctx.globalAlpha = b.opacity; ctx.strokeStyle = b.color; ctx.lineWidth = line;
    const frame = (offset: number) => {
      ctx.beginPath(); ctx.roundRect(offset, offset, Math.max(0, width - offset * 2), Math.max(0, height - offset * 2), Math.min(b.radius * height, Math.max(0, width / 2 - offset), Math.max(0, height / 2 - offset))); ctx.stroke();
    };
    if (b.style === "cinema") {
      ctx.fillStyle = b.color; ctx.fillRect(0, 0, width, line); ctx.fillRect(0, height - line, width, line);
    } else if (b.style === "frame") {
      // a print: the colour fills the whole frame but a rounded opening, which is lower by the chin at the bottom
      const chin = (b.chin ?? 0) * height, w = Math.max(0, width - line * 2), h = Math.max(0, height - line * 2 - chin);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.roundRect(line, line, w, h, Math.min(b.radius * height, w / 2, h / 2));
      ctx.fill("evenodd");
    } else if (b.style === "corners") {
      const length = Math.min(height * .1, Math.max(0, width / 2 - inset), Math.max(0, height / 2 - inset));
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[inset, inset, 1, 1], [width - inset, inset, -1, 1], [inset, height - inset, 1, -1], [width - inset, height - inset, -1, -1]]) {
        ctx.moveTo(x + dx * length, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * length);
      }
      ctx.stroke();
    } else {
      frame(inset);
      if (b.style === "double") frame(inset + line * 3);
    }
  }
  ctx.restore();
}
