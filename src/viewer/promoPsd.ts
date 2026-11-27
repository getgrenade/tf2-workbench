/**
 * A promo picture as a Photoshop file, to be finished by hand: every layer of the board is a layer of the file, in the board's order, with
 * the backdrop under them and the border where it is in the stack. The characters' dark glow is an Outer Glow effect of their layers, and a
 * text is a type layer (its outline a Stroke effect, its shadow a Drop Shadow), so all of it stays editable. A turned layer is turned in its
 * pixels (a type layer by its transform). The merged picture in the file is the one the board draws.
 */
import { writePsd, type Layer } from "ag-psd";
import { maskGrey, partsOf } from "./promoMask";
import { cutCorners, layerGlow, layerPivot, layerRect, paintBackdrop, paintStroke, renderPicture, renderText, turnPoint, type BoardLook, type LayerBlend, type PromoLayer, type PromoPicture, type TextSpec } from "./promo";

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

/** A canvas the size of the picture (times `k`), drawn on by `paint` in the picture's own units. */
function full(p: PromoPicture, paint: (ctx: CanvasRenderingContext2D) => void, k = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(p.w * k);
  c.height = Math.round(p.h * k);
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k);
  paint(ctx);
  return c;
}

/**
 * A layer's pixels, turned as it is, on a canvas just round them, and where that canvas is in the picture (it may reach past its edges);
 * in a file `k` times the picture's size.
 */
function placed(l: PromoLayer, image: CanvasImageSource, k = 1) {
  const r = layerRect(l), rot = l.rotation ?? 0, piv = layerPivot(l);
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => turnPoint(x, y, piv, rot).map((v) => v * k));
  const left = Math.floor(Math.min(...pts.map((q) => q[0]))), top = Math.floor(Math.min(...pts.map((q) => q[1])));
  const right = Math.ceil(Math.max(...pts.map((q) => q[0]))), bottom = Math.ceil(Math.max(...pts.map((q) => q[1])));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(-left, -top);
  ctx.scale(k, k);
  if (rot) {
    ctx.translate(piv[0], piv[1]);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-piv[0], -piv[1]);
  }
  ctx.drawImage(image, r.x, r.y, r.w, r.h);
  return { canvas, left, top };
}

/** A layer's fade as a Photoshop layer mask, placed and turned as its pixels are (none without one). */
function layerMask(l: PromoLayer, k = 1): Layer["mask"] {
  if (!l.mask?.on) return undefined;
  const r = layerRect(l);
  const grey = maskGrey(l.mask, Math.min(r.w * k, l.image.width), Math.min(r.h * k, l.image.height), l.mask.keep.length ? partsOf.get(l.image) : null);
  const { canvas, left, top } = placed(l, grey, k);
  // (black round it: what is outside the layer's rectangle is hidden too)
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, left, top, right: left + canvas.width, bottom: top + canvas.height, defaultColor: 0 };
}

/** A text layer as a type layer: its pixels (without the outline and shadow, which are its effects) and its text. */
async function typeLayer(l: PromoLayer, t: TextSpec, k = 1): Promise<Layer> {
  const scale = l.scale * k;
  const image = await renderText({ ...t, outline: false, shadow: false }, Math.max(1, scale));
  const { canvas, left, top } = placed(l, image, k);
  const r = layerRect(l), size = t.size * scale, pad = t.size * 0.3 * scale, lh = t.size * 1.18 * scale;
  // where the first line starts: its baseline, at the left, the middle or the right as the lines are aligned
  const ax = t.align === "left" ? r.x * k + pad : t.align === "right" ? (r.x + r.w) * k - pad : (r.x + r.w / 2) * k;
  const piv = layerPivot(l);
  const [x, y] = turnPoint(ax, r.y * k + pad + lh / 2 + size * 0.35, [piv[0] * k, piv[1] * k], l.rotation ?? 0);
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
    mask: layerMask(l, k),
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

/** A picture's layers for a Photoshop file, at `k` times its size: its backdrop, and the rest from the bottom up (the border where it is in the stack). */
async function pictureLayers(p: PromoPicture, look: BoardLook, k: number): Promise<{ backdrop: Layer; layers: Layer[] }> {
  const backdrop = p.backdrop ?? look.backdrop;
  // (round corners that are cut: the backdrop is cut round them; what is over it is left whole, to be masked in Photoshop as wanted)
  const back: Layer = { name: p.backdrop ? "Backdrop (its own)" : "Backdrop", canvas: full(p, (ctx) => { paintBackdrop(ctx, p.w, p.h, backdrop); cutCorners(ctx, p.w, p.h, look.stroke); }, k), left: 0, top: 0 };
  const children: Layer[] = [];
  const border = (): Layer => ({ name: "Border", hidden: !look.stroke.on, canvas: full(p, (ctx) => paintStroke(ctx, p.w, p.h, { ...look.stroke, on: true }, backdrop), k), left: 0, top: 0 });
  const strokeAt = Math.min(p.strokeAt ?? p.layers.length, p.layers.length);
  for (const [i, l] of p.layers.entries()) {
    if (i === strokeAt) children.push(border());
    if (l.text) { children.push(await typeLayer(l, l.text, k)); continue; }
    const { canvas, left, top } = placed(l, l.image, k);
    const glow = layerGlow(l, look);
    children.push({
      name: l.name,
      hidden: l.hidden,
      canvas,
      left,
      top,
      mask: layerMask(l, k),
      opacity: l.opacity,
      blendMode: l.blend ? PSD_BLEND[l.blend] : undefined,
      effects: glow ? { outerGlow: { enabled: true, present: true, showInDialog: true, size: px(glow.size * (p.h / 1080) * k), color: { r: 0, g: 0, b: 0 }, blendMode: "multiply", opacity: glow.strength, source: "edge" } } : undefined,
    });
  }
  if (strokeAt >= p.layers.length) children.push(border());
  return { backdrop: back, layers: children };
}

/** The PSD of a picture, as the board has it, at `k` times its size (`merged`: the picture as the export drew it, else drawn here). */
export async function picturePsd(p: PromoPicture, look: BoardLook, k = 1, merged?: HTMLCanvasElement): Promise<Uint8Array> {
  const { backdrop, layers } = await pictureLayers(p, look, k);
  if (!merged) { merged = document.createElement("canvas"); renderPicture(merged, p, look, k); }
  const buffer = writePsd({ width: Math.round(p.w * k), height: Math.round(p.h * k), canvas: merged, children: [backdrop, ...layers] }, { noBackground: true, generateThumbnail: true });
  return new Uint8Array(buffer);
}

/**
 * The size of one Photoshop file holding every picture of the board stacked: the size of the pictures (the largest, when they differ).
 * Each picture sits at the top left, as in its own file.
 */
export function stackSize(sizes: { w: number; h: number }[]): { width: number; height: number } {
  return { width: Math.max(1, ...sizes.map((s) => s.w)), height: Math.max(1, ...sizes.map((s) => s.h)) };
}

/**
 * Every picture of the board in one Photoshop file of the pictures' size (times `k`): each a folder of its own (named as the picture),
 * stacked over the others in the board's order (the first on top), with its backdrop in a Background folder at the bottom of it and its
 * other layers over it as in the picture's own file. Only the first picture's folder is shown, so the file opens looking like it (`merged`:
 * the first picture as the export drew it); the others are a click away.
 */
export async function boardPsd(pictures: PromoPicture[], look: BoardLook, k = 1, merged?: HTMLCanvasElement): Promise<Uint8Array> {
  const { width, height } = stackSize(pictures.map((p) => ({ w: Math.round(p.w * k), h: Math.round(p.h * k) })));
  const flat = document.createElement("canvas");
  flat.width = width;
  flat.height = height;
  const folders: Layer[] = [];
  for (const [i, p] of pictures.entries()) {
    const { backdrop, layers } = await pictureLayers(p, look, k);
    folders.push({ name: p.name, opened: false, hidden: i > 0, children: [{ name: "Background", opened: false, children: [backdrop] }, ...layers] });
    if (i === 0) {
      if (!merged) { merged = document.createElement("canvas"); renderPicture(merged, p, look, k); }
      flat.getContext("2d")!.drawImage(merged, 0, 0);
    }
  }
  // (a Photoshop file lists its layers bottom first: the board's first picture goes last, on top)
  folders.reverse();
  const buffer = writePsd({ width, height, canvas: flat, children: folders }, { noBackground: true, generateThumbnail: true });
  return new Uint8Array(buffer);
}
