/**
 * A promo picture as a Photoshop file, to be finished by hand: every layer of the board is a layer of the file, in the board's order, with
 * the backdrop under them and the border where it is in the stack. The characters' dark glow is an Outer Glow effect of their layers, and a
 * text is a type layer (its outline a Stroke effect, its shadow a Drop Shadow), so all of it stays editable. A turned layer is turned in its
 * pixels (a type layer by its transform). The merged picture in the file is the one the board draws.
 */
import { writePsd, type Layer } from "ag-psd";
import { layerPivot, layerRect, paintBackdrop, paintStroke, renderPicture, renderText, turnPoint, type BoardLook, type PromoLayer, type PromoPicture, type TextSpec } from "./promo";

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
    text: {
      text: t.text.replace(/\n/g, "\r"),
      transform: [c, s, -s, c, x, y],
      shapeType: "point",
      style: { font: { name: PSD_FONT[t.font] ?? "ArialMT" }, fontSize: size, fillColor: rgb(t.color), fauxBold: t.weight >= 800, autoLeading: false, leading: lh },
      paragraphStyle: { justification: t.align },
    },
  };
}

/** The PSD of a picture, as the board has it. */
export async function picturePsd(p: PromoPicture, look: BoardLook): Promise<Uint8Array> {
  const backdrop = p.backdrop ?? look.backdrop;
  const glow = look.glow?.on ? look.glow : null;
  const children: Layer[] = [{ name: p.backdrop ? "Backdrop (its own)" : "Backdrop", canvas: full(p, (ctx) => paintBackdrop(ctx, p.w, p.h, backdrop)), left: 0, top: 0 }];
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
      effects: glow && l.shot ? { outerGlow: { enabled: true, present: true, showInDialog: true, size: px(glow.size * (p.h / 1080)), color: { r: 0, g: 0, b: 0 }, blendMode: "multiply", opacity: glow.strength, source: "edge" } } : undefined,
    });
  }
  if (strokeAt >= p.layers.length) children.push(border());
  const merged = document.createElement("canvas");
  renderPicture(merged, p, look);
  const buffer = writePsd({ width: p.w, height: p.h, canvas: merged, children }, { noBackground: true, generateThumbnail: true });
  return new Uint8Array(buffer);
}
