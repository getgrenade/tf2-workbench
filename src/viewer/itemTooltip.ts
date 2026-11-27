/**
 * The tooltip of an item, as the game's backpack draws it (resource/ui/econ/itemmodelpanel.res and clientscheme.res): the name in the
 * item's quality colour in TF2 Build ("ItemFontNameLarge"), the level and type line in TanDark (117 107 94), then the paint and the
 * description in TF2 Secondary ("ItemFontAttribLarge"), on the game's own panel frame (`vgui/button_holder_central`). The fonts and the
 * frame are read from the TF2 install; without them it falls back to the interface's look.
 */
import { loadMaterial } from "../api";
import { parseMaterial, type ItemInfo, type PaintInfo } from "./payload";
import { ensureOverlayFont, overlayFontFamily } from "./overlayFonts";

/** The game's quality colours (clientscheme.res QualityColor*) and the word it puts before the name. */
export const QUALITIES: Record<string, { color: string; prefix: string }> = {
  normal: { color: "#b2b2b2", prefix: "" },
  unique: { color: "#ffd700", prefix: "" },
  vintage: { color: "#476291", prefix: "Vintage" },
  genuine: { color: "#4d7455", prefix: "Genuine" },
  strange: { color: "#cf6a32", prefix: "Strange" },
  unusual: { color: "#8650ac", prefix: "Unusual" },
  haunted: { color: "#38f3ab", prefix: "Haunted" },
  collectors: { color: "#aa0000", prefix: "Collector's" },
  community: { color: "#70b04a", prefix: "Community" },
  selfmade: { color: "#70b04a", prefix: "Self-Made" },
  valve: { color: "#a50f79", prefix: "Valve" },
  decorated: { color: "#fafafa", prefix: "" },
};

export interface TooltipLine {
  text: string;
  /** name, level (TanDark), neutral (TanLight), halloween, hint */
  kind: "name" | "level" | "neutral" | "halloween" | "hint";
  color?: string;
}

/** What the tooltip of an item says, line by line (a worn one also says its paint, and what a click on it does). */
export function itemTooltipLines(item: ItemInfo, extra: { paint?: PaintInfo | null; hint?: string } = {}): TooltipLine[] {
  const q = item.workshop ? QUALITIES.community : QUALITIES[item.quality] ?? QUALITIES.unique;
  const lines: TooltipLine[] = [{ text: [q.prefix, item.displayName].filter(Boolean).join(" "), kind: "name", color: q.color }];
  const type = item.typeName || (item.slot === "taunt" ? "Special Taunt" : "");
  const [min, max] = item.level ?? [0, 0];
  const level = min > 0 && min === max ? `Level ${min}` : "";
  if (level || type) lines.push({ text: [level, type].filter(Boolean).join(" "), kind: "level" });
  if (extra.paint) {
    lines.push(extra.paint.spell !== undefined
      ? { text: `Halloween: ${extra.paint.displayName} (spell only active during event)`, kind: "halloween" }
      : { text: `Paint Color: ${extra.paint.displayName}`, kind: "neutral" });
  }
  if (item.description) lines.push({ text: item.description, kind: "neutral" });
  if (item.workshop) lines.push({ text: "Your own item, from the workshop importer", kind: "hint" });
  if (extra.hint) lines.push({ text: extra.hint, kind: "hint" });
  return lines;
}

let tip: HTMLElement | null = null;
let frame: Promise<string | null> | null = null;

/** The game's panel frame as a picture for the tooltip's border (once; null when the install does not have it). */
function gameFrame(): Promise<string | null> {
  frame ??= (async () => {
    const material = parseMaterial(await loadMaterial("materials/vgui/button_holder_central.vmt"));
    const t = material.textures.base;
    if (!t) return null;
    const canvas = document.createElement("canvas");
    canvas.width = t.width;
    canvas.height = t.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
    return canvas.toDataURL();
  })().catch(() => null);
  return frame;
}

function element(): HTMLElement {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "itemTip";
  tip.hidden = true;
  document.body.appendChild(tip);
  void Promise.all([ensureOverlayFont("resource/tf2build.ttf"), ensureOverlayFont("resource/tf2secondary.ttf")]).then(() => {
    tip?.style.setProperty("--tip-head", overlayFontFamily("resource/tf2build.ttf"));
    tip?.style.setProperty("--tip-body", overlayFontFamily("resource/tf2secondary.ttf"));
  }).catch(() => { /* the interface's fonts */ });
  void gameFrame().then((url) => { if (url && tip) { tip.style.borderImageSource = `url(${url})`; tip.classList.add("gameFrame"); } });
  return tip;
}

function place(e: MouseEvent) {
  const t = element();
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + w > innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > innerHeight - 8) y = e.clientY - h - 16;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

function show(lines: TooltipLine[], e: MouseEvent) {
  const t = element();
  t.replaceChildren(...lines.map((l) => {
    const div = document.createElement("div");
    div.className = `tip-${l.kind}`;
    div.textContent = l.text;
    if (l.color) div.style.color = l.color;
    return div;
  }));
  t.hidden = false;
  place(e);
}

export function hideItemTooltip() { if (tip) tip.hidden = true; }

/** Shows the item's tooltip while the pointer is over `el` (in place of the plain title). */
export function attachItemTooltip(el: HTMLElement, lines: () => TooltipLine[]) {
  el.removeAttribute("title");
  el.addEventListener("mouseenter", (e) => show(lines(), e));
  el.addEventListener("mousemove", place);
  el.addEventListener("mouseleave", hideItemTooltip);
  el.addEventListener("mousedown", hideItemTooltip);
}
