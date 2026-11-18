/**
 * A promo picture as a Photoshop file, to be finished by hand: every layer of the board is a layer of the file, in the board's order, with
 * the backdrop under them and the border where it is in the stack. The characters' dark glow is an Outer Glow effect of their layers, and a
 * text is a type layer (its outline a Stroke effect, its shadow a Drop Shadow), so all of it stays editable. A turned layer is turned in its
 * pixels (a type layer by its transform). The merged picture in the file is the one the board draws.
 */
import { writePsd, type Layer } from "ag-psd";
import { maskGrey, partsOf } from "./promoMask";
import { cutCorners, layerPivot, layerRect, paintBackdrop, paintStroke, renderPicture, renderText, turnPoint, type BoardLook, type LayerBlend, type PromoLayer, type PromoPicture, type TextSpec } from "./promo";

/** The PostScript names of the text fonts, as Photoshop knows them (a font it lacks is swapped when the text is edited, not before). */
const PSD_FONT: Record<string, string> = {
  "resource/tf2build.ttf": "TF2Build",
  "resource/tf2secondary.ttf": "TF2Secondary",
  "resource/tf2professor.ttf": "TF2Professor",
  "resource/tf2.ttf": "TF2",
  "": "SegoeUI",
  "sys:Arial": "ArialMT",
  "sys:Georgia": "Georgia",
  "sys:Impact": "Impact",
  "sys:Consolas": "Consolas",
  "sys:Trebuchet MS": "TrebuchetMS",
};

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const px = (value: number) => ({ units: "Pixels" as const, value });

/** A canvas the size of the picture, drawn on by `paint`. */
function full(p: PromoPicture, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = p.w;
  c.height = p.h;
  paint(c.getContext("2d")!);
  return c;
}

/** A layer's pixels, turned as it is, on a canvas just round them, and where that canvas is in the picture (it may reach past its edges). */
function placed(l: PromoLayer, image: CanvasImageSource) {
  const r = layerRect(l), rot = l.rotation ?? 0, piv = layerPivot(l);
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => turnPoint(x, y, piv, rot));
  const left = Math.floor(Math.min(...pts.map((q) => q[0]))), top = Math.floor(Math.min(...pts.map((q) => q[1])));
  const right = Math.ceil(Math.max(...pts.map((q) => q[0]))), bottom = Math.ceil(Math.max(...pts.map((q) => q[1])));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(-left, -top);
  if (rot) {
    ctx.translate(piv[0], piv[1]);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-piv[0], -piv[1]);
  }
  ctx.drawImage(image, r.x, r.y, r.w, r.h);
  return { canvas, left, top };
}

/** A layer's fade as a Photoshop layer mask, placed and turned as its pixels are (none without one). */
function layerMask(l: PromoLayer): Layer["mask"] {
  if (!l.mask?.on) return undefined;
  const r = layerRect(l);
  const grey = maskGrey(l.mask, Math.min(r.w, l.image.width), Math.min(r.h, l.image.height), l.mask.keep.length ? partsOf.get(l.image) : null);
  const { canvas, left, top } = placed(l, grey);
  // (black round it: what is outside the layer's rectangle is hidden too)
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, left, top, right: left + canvas.width, bottom: top + canvas.height, defaultColor: 0 };
}

/** A text layer as a type layer: its pixels (without the outline and shadow, which are its effects) and its text. */
async function typeLayer(l: PromoLayer, t: TextSpec): Promise<Layer> {
  const scale = l.scale;
  const image = await renderText({ ...t, outline: false, shadow: false }, Math.max(1, scale));
  const { canvas, left, top } = placed(l, image);
  const r = layerRect(l), size = t.size * scale, pad = t.size * 0.3 * scale, lh = t.size * 1.18 * scale;
  // where the first line starts: its baseline, at the left, the middle or the right as the lines are aligned
  const ax = t.align === "left" ? r.x + pad : t.align === "right" ? r.x + r.w - pad : r.x + r.w / 2;
  const [x, y] = turnPoint(ax, r.y + pad + lh / 2 + size * 0.35, layerPivot(l), l.rotation ?? 0);
  const a = ((l.rotation ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const effects: Layer["effects"] = {};
  if (t.outline) effects.stroke = [{ enabled: true, present: true, showInDialog: true, size: px(Math.max(1, size * 0.07)), position: "outside", fillType: "color", blendMode: "normal", opacity: 0.85, color: { r: 0, g: 0, b: 0 } }];
  if (t.shadow) effects.dropShadow = [{ enabled: true, present: true, showInDialog: true, size: px(size * 0.18), distance: px(size * 0.06), angle: 90, useGlobalLight: false, blendMode: "multiply", opacity: 0.55, color: { r: 0, g: 0, b: 0 } }];
  return {
    name: l.name,
    hidden: l.hidden,
    left,
    top,
    canvas,
    effects: t.outline || t.shadow ? effects : undefined,
    mask: layerMask(l),
    text: {
      text: t.text.replace(/\n/g, "\r"),
      transform: [c, s, -s, c, x, y],
      shapeType: "point",
      style: { font: { name: PSD_FONT[t.font] ?? "ArialMT" }, fontSize: size, fillColor: rgb(t.color), fauxBold: t.weight >= 800, autoLeading: false, leading: lh },
      paragraphStyle: { justification: t.align },
    },
  };
}

/** A layer's blend as Photoshop names it. */
const PSD_BLEND: Record<LayerBlend, NonNullable<Layer["blendMode"]>> = {
  "source-over": "normal", multiply: "multiply", screen: "screen", overlay: "overlay", "soft-light": "soft light", "hard-light": "hard light", "color-dodge": "color dodge", "color-burn": "color burn", luminosity: "luminosity",
};

/** A picture's layers for a Photoshop file: its backdrop, and the rest from the bottom up (the border where it is in the stack). */
async function pictureLayers(p: PromoPicture, look: BoardLook): Promise<{ backdrop: Layer; layers: Layer[] }> {
  const backdrop = p.backdrop ?? look.backdrop;
  const glow = look.glow?.on ? look.glow : null;
  // (round corners that are cut: the backdrop is cut round them; what is over it is left whole, to be masked in Photoshop as wanted)
  const back: Layer = { name: p.backdrop ? "Backdrop (its own)" : "Backdrop", canvas: full(p, (ctx) => { paintBackdrop(ctx, p.w, p.h, backdrop); cutCorners(ctx, p.w, p.h, look.stroke); }), left: 0, top: 0 };
  const children: Layer[] = [];
  const border = (): Layer => ({ name: "Border", hidden: !look.stroke.on, canvas: full(p, (ctx) => paintStroke(ctx, p.w, p.h, { ...look.stroke, on: true }, backdrop)), left: 0, top: 0 });
  const strokeAt = Math.min(p.strokeAt ?? p.layers.length, p.layers.length);
  for (const [i, l] of p.layers.entries()) {
    if (i === strokeAt) children.push(border());
    if (l.text) { children.push(await typeLayer(l, l.text)); continue; }
    const { canvas, left, top } = placed(l, l.image);
    children.push({
      name: l.name,
      hidden: l.hidden,
      canvas,
      left,
      top,
      mask: layerMask(l),
      opacity: l.opacity,
      blendMode: l.blend ? PSD_BLEND[l.blend] : undefined,
      effects: glow && l.shot ? { outerGlow: { enabled: true, present: true, showInDialog: true, size: px(glow.size * (p.h / 1080)), color: { r: 0, g: 0, b: 0 }, blendMode: "multiply", opacity: glow.strength, source: "edge" } } : undefined,
    });
  }
  if (strokeAt >= p.layers.length) children.push(border());
  return { backdrop: back, layers: children };
}

/** The PSD of a picture, as the board has it. */
export async function picturePsd(p: PromoPicture, look: BoardLook): Promise<Uint8Array> {
  const { backdrop, layers } = await pictureLayers(p, look);
  const merged = document.createElement("canvas");
  renderPicture(merged, p, look);
  const buffer = writePsd({ width: p.w, height: p.h, canvas: merged, children: [backdrop, ...layers] }, { noBackground: true, generateThumbnail: true });
  return new Uint8Array(buffer);
}

/** Moves a layer (and its mask, its text, and the layers of a folder) by `dx`, `dy`. */
function shiftLayer(l: Layer, dx: number, dy: number) {
  if (l.left !== undefined) l.left += dx;
  if (l.top !== undefined) l.top += dy;
  if (l.right !== undefined) l.right += dx;
  if (l.bottom !== undefined) l.bottom += dy;
  if (l.mask) {
    if (l.mask.left !== undefined) l.mask.left += dx;
    if (l.mask.top !== undefined) l.mask.top += dy;
    if (l.mask.right !== undefined) l.mask.right += dx;
    if (l.mask.bottom !== undefined) l.mask.bottom += dy;
  }
  if (l.text?.transform) { l.text.transform[4] += dx; l.text.transform[5] += dy; }
  for (const c of l.children ?? []) shiftLayer(c, dx, dy);
}

/** Where each picture goes in one file: in rows, left to right, apart from each other, the rows no wider than the widest picture or 4096. */
export function sheetLayout(sizes: { w: number; h: number }[], gap = 128): { x: number; y: number }[] & { width: number; height: number } {
  const limit = Math.max(4096, ...sizes.map((s) => s.w));
  const out = [] as unknown as { x: number; y: number }[] & { width: number; height: number };
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const s of sizes) {
    if (x > 0 && x + s.w > limit) { x = 0; y += rowH + gap; rowH = 0; }
    out.push({ x, y });
    width = Math.max(width, x + s.w);
    rowH = Math.max(rowH, s.h);
    x += s.w + gap;
  }
  out.width = Math.max(1, width);
  out.height = Math.max(1, y + rowH);
  return out;
}

/**
 * Every picture of the board in one Photoshop file: each a folder of its own (named as the picture), laid out in rows apart from each
 * other, with its backdrop in a Background folder at the bottom of it and its other layers over it as in the picture's own file.
 */
export async function boardPsd(pictures: PromoPicture[], look: BoardLook): Promise<Uint8Array> {
  const at = sheetLayout(pictures.map((p) => ({ w: p.w, h: p.h })));
  const merged = document.createElement("canvas");
  merged.width = at.width;
  merged.height = at.height;
  const mctx = merged.getContext("2d")!;
  const folders: Layer[] = [];
  for (const [i, p] of pictures.entries()) {
    const { x, y } = at[i];
    const { backdrop, layers } = await pictureLayers(p, look);
    const folder: Layer = { name: p.name, opened: false, children: [{ name: "Background", opened: false, children: [backdrop] }, ...layers] };
    shiftLayer(folder, x, y);
    folders.push(folder);
    const one = document.createElement("canvas");
    renderPicture(one, p, look);
    mctx.drawImage(one, x, y);
  }
  const buffer = writePsd({ width: at.width, height: at.height, canvas: merged, children: folders }, { noBackground: true, generateThumbnail: true });
  return new Uint8Array(buffer);
}
