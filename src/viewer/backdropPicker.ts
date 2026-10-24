/**
 * The picker of a background: one row of equal thumbnails (no text): a solid colour, a picture, a custom gradient (its editor opens under the
 * row, with a button to save what is made), then the gradients saved before and those that ship with the app.
 * The same picker is the world's (behind the scene) and the promo's (behind every picture); the host says where the value lives. Picking a
 * preset fades to it; what the picked one needs (a colour, the controls of a custom gradient) shows under the row.
 */
import { BACKDROP_PICTURE_SIDE, loadBackdropPicture, paintBackdrop, type Backdrop } from "./promo";
import { SHIPPED_GRADIENTS } from "./shippedBackdrops";
import { colourBackdrop, customBackdrop, deleteGradient, fadeBackdrop, gradientPresets, renameGradient, saveGradient } from "./backdropPresets";
import { openMenu } from "./popMenu";
import { MAX_STOPS, MIN_STOPS, colourAt, hexOfRgb, sampleStops, type GradientStop } from "./gradientStops";

export interface BackdropPickerHost {
  /** The background now (null: none). */
  get(): Backdrop;
  /** The background changed; `live`: it is a step of a fade or a drag, and the final one follows. */
  set(b: Backdrop, live: boolean): void;
  /** Offers pictures (the user picks an image file; it is kept in the background as a scaled-down JPEG). */
  picture?: boolean;
}

/** A gradient's angle (ours: 0 runs to the right, 90 down) as CSS has it (0 runs up, 90 to the right, 180 down), and back. */
const cssAngle = (angle: number) => Math.round((((angle + 90) % 360) + 360) % 360);
const angleFromCss = (css: number) => (((css - 90) % 360) + 360) % 360;

/** Half the width of a stop's marker (px): the gradient's ends are this far in from the bar's edges, so a marker at an end is inside the bar. */
const STOP_INSET = 7;

/** How long a fade between two backgrounds takes (ms). */
const FADE_MS = 220;
/** A thumbnail is as big as a button of the 3D view's toolbar (30 px), drawn at twice that. */
const THUMB = 30;
const THUMB_W = THUMB, THUMB_H = THUMB;

/** A small canvas painted by `paint` (drawn at twice its size, for sharp edges). */
function thumbCanvas(paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = THUMB_W * 2;
  c.height = THUMB_H * 2;
  const ctx = c.getContext("2d");
  if (ctx) paint(ctx, c.width, c.height);
  return c;
}

/** A picture file read, scaled down to {@link BACKDROP_PICTURE_SIDE} on its long side and kept as a JPEG data URL. */
export async function pictureToDataUrl(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = url;
    });
    if (!img) return null;
    const k = Math.min(1, BACKDROP_PICTURE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A small box with a text field at a point of the screen, to type a name in: Enter keeps it, Escape or a click away leaves it. */
function askName(at: { x: number; y: number }, current: string, done: (name: string) => void) {
  const box = document.createElement("div");
  box.className = "bdAsk";
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.maxLength = 60;
  input.setAttribute("aria-label", "Name");
  box.append(input);
  document.body.append(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = `${Math.max(4, Math.min(at.x, innerWidth - w - 4))}px`;
  box.style.top = `${Math.max(4, Math.min(at.y, innerHeight - h - 4))}px`;
  const close = () => { box.remove(); window.removeEventListener("pointerdown", away, true); };
  const away = (e: PointerEvent) => { if (!box.contains(e.target as Node)) close(); };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { const name = input.value; close(); done(name); }
    else if (e.key === "Escape") close();
  };
  window.addEventListener("pointerdown", away, true);
  input.focus();
  input.select();
}

/** Asks for an image file; resolves to it as a data URL (null: none was picked). */
function choosePicture(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => resolve(input.files?.[0] ? await pictureToDataUrl(input.files[0]) : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** The icons of the buttons that are not a colour: the toolbar's line icons (see #viewToolbar), on a 24 grid. */
const IMAGE_ICON = '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="16" cy="8.5" r="1.5"/>';
const TUNE_ICON = '<path d="M4 7h6M14 7h6M4 12h2M10 12h10M4 17h9M17 17h3"/><circle cx="12" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>';

export function createBackdropPicker(host: BackdropPickerHost): { el: HTMLElement; refresh: () => void } {
  const el = document.createElement("div");
  el.className = "bdPicker";
  /** The custom gradient last made, to come back to. */
  let lastCustom: Backdrop | null = null;
  /** The solid colour last used (the solid thumbnail shows it). */
  let lastSolid = "#404040";
  /** The picture last used (the image thumbnail shows it). */
  let lastPicture: string | null = null;
  let fade = 0;
  /** What a fade is going to: the thumbnails show it at once (the host's value is on its way there). */
  let target: Backdrop | undefined;

  const current = () => target ?? host.get();

  /** Sets a background, fading to it from the one now. */
  function pick(next: Backdrop) {
    cancelAnimationFrame(fade);
    const from = host.get();
    target = undefined;
    if (next.kind === "colour") lastSolid = next.from;
    if (next.kind === "picture" && next.image) lastPicture = next.image;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      host.set(next, false);
      render();
      return;
    }
    target = next;
    const t0 = performance.now();
    const step = (at: number) => {
      const t = Math.min(1, (at - t0) / FADE_MS), e = t * t * (3 - 2 * t);
      if (t < 1) {
        host.set(fadeBackdrop(from, next, e), true);
        fade = requestAnimationFrame(step);
      } else {
        // (what is lit is already drawn: nothing to build again)
        target = undefined;
        host.set(next, false);
      }
    };
    fade = requestAnimationFrame(step);
    render();
  }

  function thumb(paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, on: boolean, click: () => void, title: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bdThumb${on ? " on" : ""}`;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.setAttribute("aria-pressed", String(on));
    b.append(thumbCanvas(paint));
    b.onclick = click;
    return b;
  }

  /** A button with an icon, like those of the toolbar of the 3D view (no colour of its own: it is lit when picked). */
  function iconButton(icon: string, on: boolean, click: () => void, title: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bdThumb bdIcon${on ? " on" : ""}`;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    b.onclick = click;
    return b;
  }

  function row(label: string, input: HTMLElement): HTMLElement {
    const r = document.createElement("label");
    r.className = "bdRow";
    r.append(label, input);
    return r;
  }
  function colourInput(value: string, set: (v: string, live: boolean) => void): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "color";
    i.value = value;
    i.oninput = () => set(i.value, true);
    i.onchange = () => set(i.value, false);
    return i;
  }
  /** A slider; with `show`, its value is the tooltip (hover to read it), kept up to date as it moves. */
  function slider(min: number, max: number, step: number, value: number, set: (v: number, live: boolean) => void, show?: (v: number) => string): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "range";
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    if (show) i.title = show(value);
    i.oninput = () => { if (show) i.title = show(Number(i.value)); set(Number(i.value), true); };
    i.onchange = () => set(Number(i.value), false);
    return i;
  }

  /** Asks for a picture and makes it the background. */
  async function addPicture() {
    const src = await choosePicture();
    if (!src) return;
    await loadBackdropPicture(src);
    pick({ ...colourBackdrop("#000000"), kind: "picture", image: src });
  }

  function render() {
    const value = current();
    // (the bar of a gradient keeps the keyboard when it is drawn again: Delete takes a stop out)
    const barHadFocus = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("bdBar") && el.contains(document.activeElement);
    el.textContent = "";
    const grid = document.createElement("div");
    grid.className = "bdGrid";
    el.append(grid);

    // the solid colour
    const solid = value.kind === "colour";
    grid.append(thumb((ctx, w, h) => { ctx.fillStyle = solid ? value.from : lastSolid; ctx.fillRect(0, 0, w, h); }, solid, () => pick(colourBackdrop(lastSolid)), "Solid colour"));

    // the picture: the one in use or the last one (picked again when it is not in use; a click on it in use asks for another)
    if (host.picture) {
      const inUse = value.kind === "picture";
      const src = inUse ? value.image ?? null : lastPicture;
      const choose = () => {
        if (inUse || !lastPicture) void addPicture();
        else pick({ ...colourBackdrop("#000000"), kind: "picture", image: lastPicture });
      };
      if (!src) grid.append(iconButton(IMAGE_ICON, false, choose, "Picture: choose an image"));
      else {
        // (once there is one, the button shows it)
        const t = thumb((ctx, w, h) => { ctx.fillStyle = "#1a1a1d"; ctx.fillRect(0, 0, w, h); }, inUse, choose, inUse ? "Picture (click to choose another)" : "Picture");
        void loadBackdropPicture(src).then((img) => {
          if (!img) return;
          const c = t.querySelector("canvas")!;
          paintBackdrop(c.getContext("2d")!, c.width, c.height, { ...colourBackdrop("#000000"), kind: "picture", image: src });
        });
        grid.append(t);
      }
    }

    // the custom gradient (its editor), then the gradients saved and shipped
    const editing = value.kind === "gradient" && !value.preset;
    const custom = editing ? value : lastCustom ?? customBackdrop(value);
    grid.append(iconButton(TUNE_ICON, editing, () => { lastCustom = customBackdrop(value.kind === "gradient" ? value : custom); pick(lastCustom); }, "Custom gradient"));
    const preset = value.kind === "gradient" ? value.preset : undefined;
    for (const p of gradientPresets()) {
      const t = thumb((ctx, w, h) => paintBackdrop(ctx, w, h, p.backdrop), preset === p.id, () => pick(p.backdrop), p.label);
      // a saved gradient has a menu: its entry for the release, or taking it out
      if (!SHIPPED_GRADIENTS.some((s) => s.id === p.id)) {
        t.title = `${p.label} (right-click for its menu)`;
        t.oncontextmenu = (e) => {
          e.preventDefault();
          openMenu({ x: e.clientX, y: e.clientY }, [
            { label: "Rename…", run: () => askName({ x: e.clientX, y: e.clientY }, p.label, (name) => renameGradient(p.id, name)) },
            { label: "Copy as JSON", hint: "an entry for shippedBackdrops.ts", run: () => void navigator.clipboard?.writeText(JSON.stringify({ id: p.id, label: p.label, backdrop: p.backdrop }, null, 2)) },
            { label: "Delete", run: () => deleteGradient(p.id) },
          ]);
        };
      }
      grid.append(t);
    }

    // what the one picked needs
    if (solid) renderColour(value);
    else if (editing) renderCustom(value);
    if (barHadFocus) el.querySelector<HTMLElement>(".bdBar")?.focus();
  }

  function renderColour(value: Backdrop) {
    const now = value.from.toLowerCase();
    el.append(row("Colour", colourInput(now, (v, live) => { const next = colourBackdrop(v); lastSolid = v; if (live) host.set(next, true); else { host.set(next, false); render(); } })));
  }

  /** The stop being edited (its place in the order), kept between drawings. */
  let selIndex = 0;

  /** The editor of a custom gradient, as Photoshop's: a bar of the gradient with its stops under it (drag them, click the bar to add one), the midpoints between them, and the stop's colour. */
  function renderCustom(value: Backdrop) {
    // (a gradient from before stops is shown as stops, and is only changed when one of them is)
    const start = customBackdrop(value);
    const work: Backdrop = { ...start, stops: start.stops!.map((s) => ({ ...s })) };
    const stops = work.stops!;
    let selected: GradientStop = stops[Math.min(selIndex, stops.length - 1)];
    const clone = (): Backdrop => ({ ...work, stops: stops.map((s) => ({ ...s })) });
    const commit = (live: boolean) => {
      stops.sort((x, y) => x.at - y.at);
      work.from = stops[0].color;
      work.to = stops[stops.length - 1].color;
      work.glow = work.from;
      delete work.preset;
      selIndex = Math.max(0, stops.indexOf(selected));
      lastCustom = clone();
      host.set(clone(), live);
    };

    const bar = document.createElement("div");
    bar.className = "bdBar";
    // the gradient runs between the middles of the first and last stop's places: a stop at either end stands inside the bar
    const fill = document.createElement("div");
    fill.className = "bdBarFill";
    const track = document.createElement("div");
    track.className = "bdTrack";
    bar.append(fill, track);
    const place = (at: number) => `calc(${STOP_INSET}px + (100% - ${STOP_INSET * 2}px) * ${at})`;
    el.append(bar);
    const hint = document.createElement("p");
    hint.className = "bdHint";
    hint.textContent = "Click the bar to add a stop. Drag a stop off the bar, right-click it or press Delete to take it out.";
    el.append(hint);

    const drawBar = () => {
      const samples = sampleStops(stops, work.softness ?? 0, 48);
      // (the colours of the ends reach to the edges of the bar, past the places of the first and last stop)
      fill.style.background = `linear-gradient(to right, ${samples[0].color} 0, ${samples.map((s) => `${s.color} ${place(s.at)}`).join(", ")}, ${samples[samples.length - 1].color} 100%)`;
    };
    const drawTrack = () => {
      track.textContent = "";
      stops.forEach((s, i) => {
        // the midpoint of the blend to the next stop
        const next = stops[i + 1];
        if (next) {
          const m = document.createElement("div");
          m.className = "bdMid";
          m.dataset.i = String(i);
          m.title = "Midpoint: where the blend to the next stop is half way";
          m.style.left = place(s.at + (next.at - s.at) * (s.mid ?? 0.5));
          track.append(m);
        }
        const d = document.createElement("div");
        d.className = `bdStop${s === selected ? " on" : ""}`;
        d.dataset.i = String(i);
        d.title = "Colour stop: drag it, or click the bar to add another";
        d.style.left = place(s.at);
        d.innerHTML = `<i style="background:${s.color}"></i>`;
        track.append(d);
      });
    };
    drawBar();
    drawTrack();

    let drag: { kind: "stop"; away: boolean } | { kind: "mid"; stop: GradientStop } | null = null;
    /** Takes the selected stop out (never below two). */
    const removeSelected = () => {
      if (stops.length <= MIN_STOPS) return false;
      const at = stops.indexOf(selected);
      stops.splice(at, 1);
      selected = stops[Math.min(at, stops.length - 1)];
      commit(false);
      render();
      return true;
    };
    const at = (e: PointerEvent) => { const r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left - STOP_INSET) / Math.max(1, r.width - STOP_INSET * 2))); };
    bar.onpointerdown = (e) => {
      const hit = (e.target as HTMLElement).closest<HTMLElement>(".bdStop, .bdMid");
      if (hit?.classList.contains("bdStop")) {
        selected = stops[Number(hit.dataset.i)];
        // (a right click takes it out)
        if (e.button === 2) { removeSelected(); return; }
        drag = { kind: "stop", away: false };
      } else if (hit?.classList.contains("bdMid")) drag = { kind: "mid", stop: stops[Number(hit.dataset.i)] };
      else if (e.target === fill && e.button === 0 && stops.length < MAX_STOPS) {
        // a click on the bar itself (not on the row of stops under it): a new stop there, in the colour the gradient has at that place
        const t = Math.round(at(e) * 1000) / 1000;
        selected = { at: t, color: hexOfRgb(colourAt([...stops].sort((x, y) => x.at - y.at), work.softness ?? 0, t)) };
        stops.push(selected);
        commit(false);
        render();
        return;
      } else return;
      e.preventDefault();
      bar.focus();
      bar.setPointerCapture(e.pointerId);
      drawTrack();
    };
    bar.onpointermove = (e) => {
      if (!drag) return;
      const t = at(e);
      if (drag.kind === "stop") {
        // dragged well away from the bar (up or down), it is taken out when let go
        const r = track.getBoundingClientRect();
        drag.away = stops.length > MIN_STOPS && Math.abs(e.clientY - (r.top + r.height / 2)) > 40;
        track.classList.toggle("out", drag.away);
        if (!drag.away) selected.at = Math.round(t * 1000) / 1000;
      } else {
        const i = stops.indexOf(drag.stop), next = stops[i + 1];
        if (next && next.at > drag.stop.at) drag.stop.mid = Math.min(0.98, Math.max(0.02, Math.round(((t - drag.stop.at) / (next.at - drag.stop.at)) * 1000) / 1000));
      }
      commit(true);
      drawBar();
      drawTrack();
    };
    const release = () => {
      if (!drag) return;
      const away = drag.kind === "stop" && drag.away;
      drag = null;
      track.classList.remove("out");
      if (away && removeSelected()) return;
      commit(false);
      render();
    };
    // the Delete key takes the selected stop out too
    bar.tabIndex = 0;
    bar.onkeydown = (e) => { if ((e.key === "Delete" || e.key === "Backspace") && removeSelected()) e.preventDefault(); };
    bar.oncontextmenu = (e) => e.preventDefault();
    bar.onpointerup = release;
    bar.onpointercancel = release;

    // the selected stop
    const i = stops.indexOf(selected);
    // (these are for the stop that was selected when they were made: the colour picker reports its last colour when it closes, which can be after another stop was clicked)
    const mine = selected;
    el.append(row("Stop", colourInput(mine.color, (v, live) => { mine.color = v; commit(live); if (live) { drawBar(); drawTrack(); } else render(); })));
    el.append(row("Location", slider(0, 100, 1, Math.round(mine.at * 100), (v, live) => { mine.at = v / 100; commit(live); drawBar(); drawTrack(); if (!live) render(); }, (v) => `${v}%`)));
    const midRow = row("Midpoint", slider(2, 98, 1, Math.round((mine.mid ?? 0.5) * 100), (v, live) => { mine.mid = v / 100; commit(live); drawBar(); drawTrack(); if (!live) render(); }, (v) => `${v}%`));
    if (i >= stops.length - 1) { midRow.classList.add("off"); midRow.querySelector("input")!.disabled = true; midRow.title = "The last stop has no blend after it"; }
    el.append(midRow);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete stop";
    remove.disabled = stops.length <= MIN_STOPS;
    remove.onclick = () => { removeSelected(); };
    el.append(remove);

    // keeps what is made (it shows in the row, in this and the other pickers)
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save gradient";
    save.title = "Keep this gradient: it shows in the row of thumbnails, to pick again";
    save.onclick = () => { const entry = saveGradient(clone()); save.textContent = `Saved as ${entry.label}`; };
    el.append(save);

    // the whole gradient
    const shape = document.createElement("div");
    shape.className = "bdSeg";
    for (const [id, label] of [["linear", "Linear"], ["radial", "Radial"]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.className = (work.shape ?? "linear") === id ? "on" : "";
      b.onclick = () => {
        if ((work.shape ?? "linear") === id) return;
        work.shape = id;
        if (id === "radial") { work.cx ??= 0.5; work.cy ??= 0.46; }
        // (fades to the other shape, as picking a gradient does)
        stops.sort((x, y) => x.at - y.at);
        work.from = stops[0].color;
        work.to = stops[stops.length - 1].color;
        work.glow = work.from;
        delete work.preset;
        lastCustom = clone();
        pick(clone());
      };
      shape.append(b);
    }
    el.append(row("Shape", shape));
    // the way a linear gradient runs, in degrees as CSS has them (0: up, 90: to the right, 180: down), which is what other tools show
    if ((work.shape ?? "linear") === "linear") {
      el.append(row("Angle", slider(0, 360, 1, cssAngle(work.angle), (v, live) => { work.angle = angleFromCss(v); commit(live); }, (v) => `${v}°`)));
    }
    el.append(row("Softness", slider(0, 100, 1, Math.round((work.softness ?? 0) * 100), (v, live) => { work.softness = v / 100; commit(live); drawBar(); if (!live) render(); }, (v) => `${v}%`)));
    if (work.shape === "radial") {
      el.append(row("Centre X", slider(0, 100, 1, Math.round((work.cx ?? 0.5) * 100), (v, live) => { work.cx = v / 100; commit(live); }, (v) => `${v}%`)));
      el.append(row("Centre Y", slider(0, 100, 1, Math.round((work.cy ?? 0.46) * 100), (v, live) => { work.cy = v / 100; commit(live); }, (v) => `${v}%`)));
    }
  }

  // (a list that changed in another picker, or a gradient taken out: drawn again; a picker that is gone lets go)
  const again = () => { if (!el.isConnected) window.removeEventListener("backdrop-presets", again); else render(); };
  window.addEventListener("backdrop-presets", again);

  render();
  return {
    el,
    refresh: () => {
      // (a slider being dragged is not rebuilt under the hand)
      if (document.activeElement && el.contains(document.activeElement) && document.activeElement.matches("input[type=range]")) return;
      render();
    },
  };
}
