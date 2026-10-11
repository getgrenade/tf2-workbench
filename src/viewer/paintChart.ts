import { layoutChart, type ChartLayout, type ChartOptions } from "./chartLayout";

/** One picture of the chart: a label (for the tooltip and the list of removed pictures) and the image, all of the same size. */
export interface ChartEntry {
  label: string;
  image: ImageBitmap;
}

/** The smallest rectangle (in pixels) that holds every non-transparent pixel of a PNG, or null when it is empty. */
export async function alphaBounds(blob: Blob): Promise<{ x0: number; y0: number; x1: number; y1: number; width: number; height: number } | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1, width, height };
  } finally {
    bitmap.close();
  }
}

/** Cuts every PNG to the same rectangle and shrinks them to fit `maxSide`, so the pictures line up in the chart. */
export async function cropImages(blobs: Blob[], rect: { x0: number; y0: number; x1: number; y1: number }, maxSide: number): Promise<ImageBitmap[]> {
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const out: ImageBitmap[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  for (const blob of blobs) {
    const bitmap = await createImageBitmap(blob);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, rect.x0, rect.y0, w, h, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    out.push(await createImageBitmap(canvas));
  }
  return out;
}

const BACKGROUNDS = [
  { id: "transparent", label: "Transparent", color: null },
  { id: "dark", label: "Dark brown", color: "#2d1f1d" },
  { id: "custom", label: "Custom colour", color: null },
] as const;

/**
 * The paint chart editor: the pictures laid out in a grid that fills the picture, with controls for the gaps, the columns, the size and
 * the background. Click a picture to take it out (the rest are laid out again to fill the space); the removed ones are listed below to
 * put back. `save` gets the PNG of the chart.
 */
export function openPaintChart(entries: ChartEntry[], title: string, save: (blob: Blob) => Promise<void>) {
  const aspect = entries.length ? entries[0].image.width / entries[0].image.height : 1;
  const removed = new Set<number>();
  const state = { width: 1920, height: 1080, gapX: 24, gapY: 24, padding: 48, cols: 0, background: "transparent", custom: "#2d1f1d" };

  const back = document.createElement("div");
  back.className = "chartBack";
  back.innerHTML = `<div class="chartBox" role="dialog" aria-modal="true">
    <div class="chartMain"><div class="chartHead"></div><div class="chartStage"><canvas></canvas></div><div class="chartRemoved"></div></div>
    <div class="chartSide"></div></div>`;
  (back.querySelector(".chartHead") as HTMLElement).textContent = title;
  const canvas = back.querySelector("canvas") as HTMLCanvasElement;
  const removedBox = back.querySelector(".chartRemoved") as HTMLElement;
  const side = back.querySelector(".chartSide") as HTMLElement;

  // --- controls ---
  const slider = (label: string, min: number, max: number, step: number, key: "gapX" | "gapY" | "padding" | "cols", show?: (v: number) => string) => {
    const row = document.createElement("label");
    row.className = "chartRow";
    const out = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(state[key]);
    const sync = () => (out.textContent = show ? show(Number(input.value)) : input.value);
    input.oninput = () => {
      state[key] = Number(input.value);
      sync();
      draw();
    };
    sync();
    row.append(label, out, input);
    side.appendChild(row);
  };
  const choice = (label: string, options: [string, string][], value: string, apply: (v: string) => void) => {
    const row = document.createElement("label");
    row.className = "chartRow inline";
    const select = document.createElement("select");
    for (const [v, t] of options) select.add(new Option(t, v));
    select.value = value;
    select.onchange = () => {
      apply(select.value);
      draw();
    };
    row.append(label, select);
    side.appendChild(row);
    return select;
  };
  const heading = document.createElement("h3");
  heading.textContent = "Layout";
  side.appendChild(heading);
  slider("Columns", 0, 16, 1, "cols", (v) => (v === 0 ? "Auto" : String(v)));
  slider("Gap across", 0, 200, 1, "gapX");
  slider("Gap down", 0, 200, 1, "gapY");
  slider("Edge margin", 0, 300, 1, "padding");
  const heading2 = document.createElement("h3");
  heading2.textContent = "Picture";
  side.appendChild(heading2);
  choice("Resolution (16:9)", [["1280", "720p (1280 × 720)"], ["1920", "1080p (1920 × 1080)"], ["2560", "1440p (2560 × 1440)"], ["3840", "4K (3840 × 2160)"]], "1920", (v) => {
    state.width = Number(v);
    state.height = Math.round((state.width * 9) / 16);
  });
  const colour = document.createElement("input");
  colour.type = "color";
  colour.value = state.custom;
  colour.hidden = true;
  colour.oninput = () => {
    state.custom = colour.value;
    draw();
  };
  choice("Background", BACKGROUNDS.map((b) => [b.id, b.label]), state.background, (v) => {
    state.background = v;
    colour.hidden = v !== "custom";
  });
  side.appendChild(colour);
  const info = document.createElement("div");
  info.className = "dim hint chartInfo";
  side.appendChild(info);
  const buttons = document.createElement("div");
  buttons.className = "btns";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "Save PNG…";
  buttons.append(closeBtn, saveBtn);
  side.appendChild(buttons);

  // --- drawing ---
  let layout: ChartLayout | null = null;
  let order: number[] = [];
  let hover = -1;

  function options(): ChartOptions {
    return { width: state.width, height: state.height, gapX: state.gapX, gapY: state.gapY, padding: state.padding, cols: state.cols };
  }

  function paint(target: HTMLCanvasElement, l: ChartLayout, withHover: boolean) {
    target.width = l.width;
    target.height = l.height;
    const ctx = target.getContext("2d")!;
    ctx.clearRect(0, 0, l.width, l.height);
    const fill = state.background === "dark" ? "#2d1f1d" : state.background === "custom" ? state.custom : null;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, l.width, l.height);
    }
    ctx.imageSmoothingQuality = "high";
    order.forEach((index, slot) => {
      const r = l.rects[slot];
      ctx.drawImage(entries[index].image, r.x, r.y, r.w, r.h);
      if (withHover && slot === hover) {
        ctx.fillStyle = "#e5483f55";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#e5483f";
        ctx.lineWidth = Math.max(2, l.width / 500);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    });
  }

  /** The preview is the picture itself at the stage's size, so its frame is the chart's 16:9. */
  function fit() {
    const stage = canvas.parentElement!;
    const w = stage.clientWidth - 2, h = stage.clientHeight - 2;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(w / state.width, h / state.height);
    canvas.style.width = `${Math.floor(state.width * scale)}px`;
    canvas.style.height = `${Math.floor(state.height * scale)}px`;
  }

  function draw() {
    order = entries.map((_, i) => i).filter((i) => !removed.has(i));
    layout = layoutChart(order.length, aspect, options());
    paint(canvas, layout, true);
    fit();
    info.textContent = `${order.length} picture${order.length === 1 ? "" : "s"}, ${layout.cols} column${layout.cols === 1 ? "" : "s"} × ${layout.rows} row${layout.rows === 1 ? "" : "s"}, ${layout.width} × ${layout.height} px (16:9)`;
    saveBtn.disabled = order.length === 0;
    removedBox.replaceChildren();
    if (removed.size) {
      const label = document.createElement("span");
      label.className = "dim";
      label.textContent = `Removed (${removed.size}), click to put back: `;
      removedBox.appendChild(label);
      for (const i of [...removed].sort((a, b) => a - b)) {
        const chip = document.createElement("button");
        chip.textContent = entries[i].label;
        chip.onclick = () => {
          removed.delete(i);
          draw();
        };
        removedBox.appendChild(chip);
      }
      const all = document.createElement("button");
      all.textContent = "Put all back";
      all.onclick = () => {
        removed.clear();
        draw();
      };
      removedBox.appendChild(all);
    }
  }

  const slotAt = (ev: PointerEvent) => {
    if (!layout) return -1;
    const box = canvas.getBoundingClientRect();
    const x = ((ev.clientX - box.left) / box.width) * layout.width;
    const y = ((ev.clientY - box.top) / box.height) * layout.height;
    return layout.rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  };
  canvas.onpointermove = (ev) => {
    const slot = slotAt(ev);
    if (slot === hover) return;
    hover = slot;
    canvas.title = slot >= 0 ? `${entries[order[slot]].label}: click to take it out` : "";
    if (layout) paint(canvas, layout, true);
  };
  canvas.onpointerleave = () => {
    hover = -1;
    if (layout) paint(canvas, layout, true);
  };
  canvas.onclick = (ev) => {
    const slot = slotAt(ev as PointerEvent);
    if (slot < 0) return;
    removed.add(order[slot]);
    hover = -1;
    draw();
  };

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    resize.disconnect();
    back.remove();
    for (const e of entries) e.image.close();
  };
  function onKey(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  }
  closeBtn.onclick = close;
  saveBtn.onclick = async () => {
    if (!layout) return;
    const target = document.createElement("canvas");
    paint(target, layout, false);
    saveBtn.disabled = true;
    try {
      const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, "image/png"));
      if (blob) await save(blob);
    } finally {
      saveBtn.disabled = order.length === 0;
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(back);
  const resize = new ResizeObserver(fit);
  resize.observe(canvas.parentElement!);
  draw();
}
