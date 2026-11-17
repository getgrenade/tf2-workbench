import { MAX_STOPS, MIN_STOPS, colourAt, hexOfRgb, sampleStops, type GradientStop } from "./gradientStops";

/**
 * The editor of a gradient's colour stops, as Photoshop's: a bar to click for a new stop, stops and midpoints to drag under it, and the
 * selected stop's colour, place and midpoint. The backdrop picker's custom gradient and the compiler's vis dev fill both use it.
 */

/** Half the width of a stop's marker (px): the gradient's ends are this far in from the bar's edges, so a marker at an end is inside the bar. */
const STOP_INSET = 7;

/** A labelled row (label on the left, its control on the right). */
export function stopsRow(label: string, input: HTMLElement): HTMLElement {
  const r = document.createElement("label");
  r.className = "bdRow";
  r.append(label, input);
  return r;
}

/** A colour picker that reports while it is dragged (`live`) and once it settles. */
export function stopsColour(value: string, set: (v: string, live: boolean) => void): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "color";
  i.value = value;
  i.oninput = () => set(i.value, true);
  i.onchange = () => set(i.value, false);
  return i;
}

/** A slider that reports while it is dragged (`live`) and once it settles; `show` makes its tooltip. */
export function stopsSlider(min: number, max: number, step: number, value: number, set: (v: number, live: boolean) => void, show?: (v: number) => string): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(min); i.max = String(max); i.step = String(step);
  i.value = String(value);
  if (show) i.title = show(value);
  i.oninput = () => { if (show) i.title = show(Number(i.value)); set(Number(i.value), true); };
  i.onchange = () => set(Number(i.value), false);
  return i;
}

export interface StopsEditorOptions {
  /** The stops, changed in place (kept in order). */
  stops: GradientStop[];
  /** The softness of the gradient (how its blends ease), for the bar's picture and the colour of a new stop. */
  softness: () => number;
  /** Which stop is selected (its index). */
  selected: number;
  /** The stops changed (sorted); `live`: a step of a drag, the final one follows. `selected` is the selected stop's index now. */
  commit(live: boolean, selected: number): void;
  /** Draws the editor again (a stop added or taken out, a drag over). */
  render(): void;
}

/** The bar with its stops, a hint, and the rows of the selected stop. `drawBar` paints the bar again (after the softness changed). */
export function stopsEditor(o: StopsEditorOptions): { parts: HTMLElement[]; drawBar: () => void } {
  const stops = o.stops;
  let selected: GradientStop = stops[Math.min(o.selected, stops.length - 1)];
  const commit = (live: boolean) => {
    stops.sort((x, y) => x.at - y.at);
    o.commit(live, Math.max(0, stops.indexOf(selected)));
  };
  const parts: HTMLElement[] = [];

  const bar = document.createElement("div");
  bar.className = "bdBar";
  // the gradient runs between the middles of the first and last stop's places: a stop at either end stands inside the bar
  const fill = document.createElement("div");
  fill.className = "bdBarFill";
  const track = document.createElement("div");
  track.className = "bdTrack";
  bar.append(fill, track);
  const place = (at: number) => `calc(${STOP_INSET}px + (100% - ${STOP_INSET * 2}px) * ${at})`;
  parts.push(bar);
  const hint = document.createElement("p");
  hint.className = "bdHint";
  hint.textContent = "Click the bar to add a stop. Drag a stop off the bar, right-click it or press Delete to take it out.";
  parts.push(hint);

  const drawBar = () => {
    const samples = sampleStops(stops, o.softness(), 48);
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
    o.render();
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
      selected = { at: t, color: hexOfRgb(colourAt([...stops].sort((x, y) => x.at - y.at), o.softness(), t)) };
      stops.push(selected);
      commit(false);
      o.render();
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
    o.render();
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
  parts.push(stopsRow("Stop", stopsColour(mine.color, (v, live) => { mine.color = v; commit(live); if (live) { drawBar(); drawTrack(); } else o.render(); })));
  parts.push(stopsRow("Location", stopsSlider(0, 100, 1, Math.round(mine.at * 100), (v, live) => { mine.at = v / 100; commit(live); drawBar(); drawTrack(); if (!live) o.render(); }, (v) => `${v}%`)));
  const midRow = stopsRow("Midpoint", stopsSlider(2, 98, 1, Math.round((mine.mid ?? 0.5) * 100), (v, live) => { mine.mid = v / 100; commit(live); drawBar(); drawTrack(); if (!live) o.render(); }, (v) => `${v}%`));
  if (i >= stops.length - 1) { midRow.classList.add("off"); midRow.querySelector("input")!.disabled = true; midRow.title = "The last stop has no blend after it"; }
  parts.push(midRow);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Delete stop";
  remove.disabled = stops.length <= MIN_STOPS;
  remove.onclick = () => { removeSelected(); };
  parts.push(remove);
  return { parts, drawBar };
}
