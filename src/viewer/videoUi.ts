import { effectiveScale, GIF_MAX_SIDE, VIDEO_FPS, VIDEO_LIMITS, type VideoFormat, type VideoOptions, type VideoSource } from "./videoRecorder";

const KEY = "videoOptions";

const DEFAULTS: VideoOptions & { fpsGif: number } = { source: "live", format: "mp4", scale: 0.5, fps: 30, fpsGif: 15, seconds: 5, turn: 360 };

function load(): VideoOptions & { fpsGif: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<typeof DEFAULTS> | null;
    if (raw) return clean({ ...DEFAULTS, ...raw });
  } catch { /* no storage: the defaults */ }
  return { ...DEFAULTS };
}
function clean(o: typeof DEFAULTS): typeof DEFAULTS {
  const [lo, hi] = VIDEO_LIMITS.seconds, [tlo, thi] = VIDEO_LIMITS.turn;
  return {
    source: o.source === "turntable" ? "turntable" : "live",
    format: o.format === "webm" || o.format === "gif" ? o.format : "mp4",
    scale: (VIDEO_LIMITS.scales as readonly number[]).includes(o.scale) ? o.scale : DEFAULTS.scale,
    fps: VIDEO_FPS.mp4.includes(o.fps) ? o.fps : DEFAULTS.fps,
    fpsGif: VIDEO_FPS.gif.includes(o.fpsGif) ? o.fpsGif : DEFAULTS.fpsGif,
    seconds: Number.isFinite(o.seconds) ? Math.max(lo, Math.min(hi, o.seconds)) : DEFAULTS.seconds,
    turn: Number.isFinite(o.turn) ? Math.max(tlo, Math.min(thi, o.turn)) : DEFAULTS.turn,
  };
}

export interface VideoPanelHost {
  /** The size of a picture of the view at full size (the active camera's picture or the view). */
  baseSize(): { w: number; h: number };
  /** Starts rendering. It resolves when the file is written, was cancelled, or failed; `report` shows progress. */
  record(options: VideoOptions, signal: AbortSignal, report: (text: string) => void): Promise<void>;
}

let closePanel: (() => void) | null = null;

/** Opens (or closes, when it is already open) the video panel beside `anchor`. */
export function toggleVideoPanel(anchor: HTMLElement, host: VideoPanelHost) {
  if (closePanel) { closePanel(); return; }
  const o = load();
  const panel = document.createElement("div");
  panel.className = "videoPanel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Record video");

  const row = (label: string, ...controls: HTMLElement[]) => {
    const el = document.createElement("div");
    el.className = "videoRow";
    const text = document.createElement("span");
    text.className = "dim";
    text.textContent = label;
    el.append(text, ...controls);
    panel.append(el);
    return el;
  };
  const segment = <T extends string>(items: [T, string, string?][], get: () => T, set: (v: T) => void) => {
    const box = document.createElement("div");
    box.className = "slotBtns";
    const buttons = items.map(([value, label, title]) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; if (title) b.title = title;
      b.onclick = () => { set(value); sync(); };
      box.append(b);
      return [value, b] as const;
    });
    return { box, refresh: () => buttons.forEach(([value, b]) => b.classList.toggle("on", value === get())) };
  };

  const source = segment<VideoSource>([["live", "Live view", "Records the scene as it moves now: the animations, the particles, the weapon"], ["turntable", "Turntable", "The camera turns round the character while the scene plays"]], () => o.source, (v) => (o.source = v));
  const format = segment<VideoFormat>([["mp4", "MP4", "H.264"], ["webm", "WebM"], ["gif", "GIF", `Optimized: one palette, only the changes are stored; the longest side stops at ${GIF_MAX_SIDE} pixels`]], () => o.format, (v) => (o.format = v));
  row("Record", source.box);
  row("Format", format.box);

  const size = document.createElement("select");
  size.setAttribute("aria-label", "Size");
  const fps = document.createElement("select");
  fps.setAttribute("aria-label", "Frame rate");
  const seconds = document.createElement("input");
  seconds.type = "number"; seconds.className = "settingNumber"; seconds.min = String(VIDEO_LIMITS.seconds[0]); seconds.max = String(VIDEO_LIMITS.seconds[1]); seconds.step = "1";
  seconds.setAttribute("aria-label", "Seconds");
  const turn = document.createElement("input");
  turn.type = "number"; turn.className = "settingNumber"; turn.min = String(VIDEO_LIMITS.turn[0]); turn.max = String(VIDEO_LIMITS.turn[1]); turn.step = "45";
  turn.setAttribute("aria-label", "Degrees");
  turn.title = "How far the camera turns in that time; negative turns the other way. 360 loops";
  const sizeNote = document.createElement("span");
  sizeNote.className = "dim hint";
  const sizeRow = row("Size", size, sizeNote);
  const fpsRow = row("Frame rate", fps);
  const secondsRow = row("Length (s)", seconds);
  const turnRow = row("Turn (°)", turn);
  void sizeRow; void fpsRow; void secondsRow;

  size.onchange = () => { o.scale = Number(size.value); sync(); };
  fps.onchange = () => { if (o.format === "gif") o.fpsGif = Number(fps.value); else o.fps = Number(fps.value); sync(); };
  seconds.onchange = () => { o.seconds = seconds.valueAsNumber; sync(); };
  turn.onchange = () => { o.turn = turn.valueAsNumber; sync(); };

  const go = document.createElement("button");
  go.type = "button";
  go.className = "videoGo";
  const status = document.createElement("div");
  status.className = "dim hint videoStatus";
  status.setAttribute("role", "status");
  panel.append(go, status);

  let busy: AbortController | null = null;
  function sync() {
    Object.assign(o, clean(o));
    source.refresh(); format.refresh();
    turnRow.hidden = o.source !== "turntable";
    const base = host.baseSize();
    const scale = effectiveScale(base, o);
    size.replaceChildren(...VIDEO_LIMITS.scales.map((s) => new Option(`${Math.round(s * 100)}%`, String(s))));
    size.value = String(o.scale);
    sizeNote.textContent = `${Math.max(2, Math.round(base.w * scale) & ~1)}×${Math.max(2, Math.round(base.h * scale) & ~1)}`;
    sizeNote.title = o.format === "gif" && scale < Math.min(1, o.scale) ? `A GIF stops at ${GIF_MAX_SIDE} pixels on its longest side` : "";
    const rates = VIDEO_FPS[o.format === "gif" ? "gif" : "mp4"];
    fps.replaceChildren(...rates.map((r) => new Option(`${r} fps`, String(r))));
    fps.value = String(o.format === "gif" ? o.fpsGif : o.fps);
    seconds.value = String(o.seconds);
    turn.value = String(o.turn);
    for (const el of [size, fps, seconds, turn]) el.disabled = !!busy;
    for (const b of panel.querySelectorAll<HTMLButtonElement>(".slotBtns button")) b.disabled = !!busy;
    go.textContent = busy ? "Cancel" : o.source === "turntable" ? "Render turntable" : "Record";
    go.classList.toggle("on", !busy);
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* not kept */ }
  }
  go.onclick = async () => {
    if (busy) { busy.abort(); return; }
    busy = new AbortController();
    sync();
    status.textContent = "";
    const options: VideoOptions = { source: o.source, format: o.format, scale: o.scale, fps: o.format === "gif" ? o.fpsGif : o.fps, seconds: o.seconds, turn: o.turn };
    try { await host.record(options, busy.signal, (t) => (status.textContent = t)); }
    catch (e) { status.textContent = e instanceof Error && e.message === "Cancelled" ? "Cancelled." : `Failed: ${e instanceof Error ? e.message : String(e)}`; }
    finally { busy = null; if (panel.isConnected) sync(); }
  };

  document.body.append(panel);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const left = a.right + 8 + w <= window.innerWidth ? a.right + 8 : Math.max(8, a.left - 8 - w);
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(8, Math.min(a.top, window.innerHeight - h - 8))}px`;
  };
  sync();
  place();
  const close = () => {
    if (busy) busy.abort();
    panel.remove();
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", place);
    closePanel = null;
  };
  // a running render keeps the panel (and goes on if it is clicked away from); only the button, Escape or Cancel end it
  const onDown = (e: PointerEvent) => { if (!busy && !panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (busy) busy.abort(); else close(); } };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", place);
  closePanel = close;
}
