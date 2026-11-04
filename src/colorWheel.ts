import { icon } from "./icons";
import { pickScreenColor } from "./api";

/**
 * The app's colour picker: a hue ring around a saturation/value square, in place of the WebView's wide popup (whose eyedropper does nothing
 * here). It takes over every `<input type="color">`: the input keeps its value and gets the usual `input` events while dragging and a
 * `change` when a drag ends, so the panels need nothing of their own.
 */
export function installColorWheel() {
  document.addEventListener("click", (ev) => {
    const input = ev.target as HTMLInputElement | null;
    if (!(input instanceof HTMLInputElement) || input.type !== "color" || input.disabled) return;
    ev.preventDefault(); // no native popup
    if (open?.input === input) { close(); return; }
    show(input);
  }, true);
  document.addEventListener("pointerdown", (ev) => {
    if (open && !open.popup.contains(ev.target as Node) && ev.target !== open.input && !picking) close();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && open && !picking) close();
  }, true);
  window.addEventListener("resize", () => close());
}

const SIZE = 200;
const OUTER = SIZE / 2 - 2;
const INNER = OUTER - 15;
const HALF = Math.floor(INNER * Math.SQRT1_2) - 5; // half the square's side: it sits inside the ring with a gap

const MODE_KEY = "tf2workbench.colorWheelMode";

let open: { input: HTMLInputElement; popup: HTMLElement } | null = null;
let picking = false;

function close() {
  open?.popup.remove();
  open = null;
}

function show(input: HTMLInputElement) {
  close();
  let [h, s, v] = rgbToHsv(hexToRgb(input.value));

  const popup = document.createElement("div");
  popup.className = "colorWheel";
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.height = Math.round(SIZE * dpr);
  canvas.style.width = canvas.style.height = `${SIZE}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const swatch = document.createElement("div");
  swatch.className = "cwSwatch";
  const now = document.createElement("span");
  now.className = "cwNow";
  swatch.append(now);
  const hex = document.createElement("input");
  hex.className = "cwHex";
  hex.spellcheck = false;
  hex.maxLength = 7;
  const dropper = document.createElement("button");
  dropper.type = "button";
  dropper.className = "cwDropper";
  dropper.title = "Pick a colour from the screen (Escape cancels)";
  dropper.setAttribute("aria-label", dropper.title);
  dropper.innerHTML = icon("pipette");
  // the numbers, as RGB (0-255) or HSV (degrees, percent): the choice is remembered
  let mode: "rgb" | "hsv" = "rgb";
  try { if (localStorage.getItem(MODE_KEY) === "hsv") mode = "hsv"; } catch { /* RGB */ }
  const seg = document.createElement("div");
  seg.className = "cwSeg";
  const modeButtons = (["rgb", "hsv"] as const).map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = m.toUpperCase();
    b.onclick = () => {
      mode = m;
      try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ }
      showValue();
    };
    seg.append(b);
    return b;
  });
  const nums = document.createElement("div");
  nums.className = "cwNums";
  const fields = [0, 1, 2].map((i) => {
    const label = document.createElement("label");
    const name = document.createElement("span");
    const box = document.createElement("input");
    box.type = "number";
    box.onfocus = () => box.select();
    box.onchange = () => {
      const typed = Number(box.value);
      if (!Number.isFinite(typed)) { showValue(); return; }
      if (mode === "rgb") {
        const rgb = hsvToRgb(h, s, v);
        rgb[i] = Math.min(255, Math.max(0, Math.round(typed)));
        setRgb(rgb);
      } else {
        if (i === 0) h = ((typed % 360) + 360) % 360;
        else if (i === 1) s = Math.min(100, Math.max(0, typed)) / 100;
        else v = Math.min(100, Math.max(0, typed)) / 100;
        emit(true);
      }
    };
    box.onkeydown = (ev) => { if (ev.key === "Enter") box.blur(); };
    label.append(name, box);
    nums.append(label);
    return { name, box };
  });
  const grid = document.createElement("div");
  grid.className = "cwGrid";
  grid.append(swatch, hex, dropper, seg, nums);
  popup.append(canvas, grid);
  document.body.append(popup);
  open = { input, popup };

  const c = SIZE / 2;
  const draw = () => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    // the ring: hue clockwise from the top
    const ring = ctx.createConicGradient(-Math.PI / 2, c, c);
    for (let i = 0; i <= 6; i++) ring.addColorStop(i / 6, `hsl(${i * 60} 100% 50%)`);
    ctx.beginPath();
    ctx.arc(c, c, OUTER, 0, Math.PI * 2);
    ctx.arc(c, c, INNER, 0, Math.PI * 2, true);
    ctx.fillStyle = ring;
    ctx.fill();
    // the square: saturation left to right, value top to bottom
    const x0 = c - HALF, side = HALF * 2;
    ctx.fillStyle = `hsl(${h} 100% 50%)`;
    ctx.fillRect(x0, x0, side, side);
    const white = ctx.createLinearGradient(x0, 0, x0 + side, 0);
    white.addColorStop(0, "#fff"); white.addColorStop(1, "#fff0");
    ctx.fillStyle = white;
    ctx.fillRect(x0, x0, side, side);
    const black = ctx.createLinearGradient(0, x0, 0, x0 + side);
    black.addColorStop(0, "#0000"); black.addColorStop(1, "#000");
    ctx.fillStyle = black;
    ctx.fillRect(x0, x0, side, side);
    // the markers
    const a = (h / 360) * Math.PI * 2 - Math.PI / 2, mid = (OUTER + INNER) / 2;
    marker(c + Math.cos(a) * mid, c + Math.sin(a) * mid, (OUTER - INNER) / 2 + 1);
    marker(x0 + s * side, x0 + (1 - v) * side, 5);
  };
  const marker = (x: number, y: number, r: number) => {
    ctx.lineWidth = 3; ctx.strokeStyle = "#000a";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  };
  const showValue = () => {
    const value = rgbToHex(hsvToRgb(h, s, v));
    now.style.background = value;
    if (document.activeElement !== hex) hex.value = value;
    const rgb = hsvToRgb(h, s, v);
    const shown = mode === "rgb" ? rgb : [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
    const names = mode === "rgb" ? "RGB" : "HSV";
    const max = mode === "rgb" ? [255, 255, 255] : [359, 100, 100];
    fields.forEach((f, i) => {
      f.name.textContent = names[i];
      f.box.min = "0";
      f.box.max = String(max[i]);
      if (document.activeElement !== f.box) f.box.value = String(shown[i]);
    });
    modeButtons.forEach((b, i) => b.classList.toggle("on", (i === 0) === (mode === "rgb")));
    draw();
    return value;
  };
  const emit = (final: boolean) => {
    input.value = showValue();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (final) input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const setRgb = (rgb: [number, number, number]) => {
    const [nh, ns, nv] = rgbToHsv(rgb);
    // grey has no hue: the ring stays where it was
    if (ns > 0 && nv > 0) h = nh;
    s = ns; v = nv;
    emit(true);
  };

  let drag: "ring" | "square" | null = null;
  const at = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left - c, y = ev.clientY - r.top - c;
    if (drag === "ring") h = ((Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2) * 360 + 360) % 360;
    else {
      s = Math.min(1, Math.max(0, (x + HALF) / (HALF * 2)));
      v = Math.min(1, Math.max(0, 1 - (y + HALF) / (HALF * 2)));
    }
    emit(false);
  };
  canvas.onpointerdown = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left - c, y = ev.clientY - r.top - c, d = Math.hypot(x, y);
    drag = d >= INNER - 2 && d <= OUTER + 2 ? "ring" : Math.abs(x) <= HALF + 4 && Math.abs(y) <= HALF + 4 ? "square" : null;
    if (!drag) return;
    canvas.setPointerCapture(ev.pointerId);
    at(ev);
  };
  canvas.onpointermove = (ev) => { if (drag) at(ev); };
  canvas.onpointerup = canvas.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    emit(true);
  };
  hex.onchange = () => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.value.trim());
    if (m) setRgb(hexToRgb("#" + m[1]));
    else hex.value = rgbToHex(hsvToRgb(h, s, v));
  };
  hex.onkeydown = (ev) => { if (ev.key === "Enter") hex.blur(); };
  dropper.onclick = async () => {
    // a cover over the app takes the click that picks, so it does nothing else here
    const cover = document.createElement("div");
    cover.className = "cwCover";
    document.body.append(cover);
    picking = true;
    try {
      const rgb = await pickScreenColor().catch(() => null);
      if (rgb && open?.input === input) setRgb(rgb);
    } finally {
      cover.remove();
      // the Escape or click that ended the pick is not also taken as closing the wheel
      setTimeout(() => { picking = false; }, 0);
    }
  };

  showValue();
  // below the input, kept on the screen
  const r = input.getBoundingClientRect();
  const w = popup.offsetWidth, ph = popup.offsetHeight;
  const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
  const top = r.bottom + 4 + ph <= window.innerHeight ? r.bottom + 4 : Math.max(4, r.top - ph - 4);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function hexToRgb(hex: string): [number, number, number] {
  let x = hex.replace("#", "");
  if (x.length === 3) x = x.split("").map((ch) => ch + ch).join("");
  const n = parseInt(x, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

function rgbToHex(rgb: readonly number[]): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function rgbToHsv([r, g, b]: readonly number[]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)];
}
