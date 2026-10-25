/**
 * The pivot of a thumbnail's studio light, as a ball lit by the rig, seen from the camera: a marker for each light (K, F, R; faded when
 * the light is behind the ball). Drag the ball to turn the pivot (the three lights together, round and over); drag a marker to move that
 * light alone; arrow keys turn the pivot (Shift: farther); a double-click puts the pivot back.
 */
import { lightColor, lightDirection } from "./lighting";
import { STUDIO_LABELS, STUDIO_ROLES, lampAnglesFor, studioAngles, type StudioLight, type StudioRole } from "./studioLight";

const SIZE = 168;
const C = SIZE / 2;
/** The ball's radius, and how far out the markers sit (a little past the ball, so that a light at the edge stays in reach). */
const BALL = 62, MARK = 70;
/** Degrees of pivot per pixel of drag. */
const TURN = 0.6;

export function createStudioSphere(get: () => StudioLight, change: (s: StudioLight, final: boolean) => void) {
  const canvas = document.createElement("canvas");
  const pr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  canvas.width = canvas.height = SIZE * pr;
  canvas.className = "studioSphere";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Studio light pivot: drag to turn the three lights together, drag a light to move it alone");
  canvas.title = "Drag the ball to turn all three lights together (the pivot) · drag K, F or R to move that light alone · arrow keys turn the pivot (Shift: 10°) · double-click: the pivot back to the front";
  const ctx = canvas.getContext("2d")!;
  // the ball is drawn at the canvas's own size, then scaled up for a sharp screen
  const ball = document.createElement("canvas");
  ball.width = ball.height = SIZE;
  const bctx = ball.getContext("2d")!;
  const pixels = bctx.createImageData(SIZE, SIZE);
  let drawn = "";

  /** Where a light's marker is drawn, and whether it is in front of the ball. */
  const markerOf = (s: StudioLight, role: StudioRole) => {
    const d = lightDirection(...studioAngles(s, role));
    return { x: C + d.x * MARK, y: C - d.y * MARK, front: d.z >= 0 };
  };
  const pointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };

  let drag: { role: StudioRole | null; x: number; y: number; front: boolean } | null = null;
  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    const s = get(), p = pointer(e);
    // the marker under the pointer (the nearest, front ones first), else the ball: the pivot
    let hit: StudioRole | null = null, best = 13 * 13;
    for (const role of STUDIO_ROLES) {
      const m = markerOf(s, role);
      const d = (m.x - p.x) ** 2 + (m.y - p.y) ** 2 - (m.front ? 40 : 0);
      if (d < best) { best = d; hit = role; }
    }
    drag = { role: hit, x: p.x, y: p.y, front: hit ? markerOf(s, hit).front : true };
  };
  canvas.onpointermove = (e) => {
    if (!drag) {
      // (the cursor says what a press would do)
      const s = get(), p = pointer(e);
      canvas.style.cursor = STUDIO_ROLES.some((r) => { const m = markerOf(s, r); return (m.x - p.x) ** 2 + (m.y - p.y) ** 2 < 13 * 13; }) ? "move" : "";
      return;
    }
    const s = structuredClone(get()), p = pointer(e);
    if (drag.role) {
      // the light goes where the pointer is on the ball, on the side of it the light was (a rim stays behind)
      let x = (p.x - C) / MARK, y = (C - p.y) / MARK;
      const r = Math.hypot(x, y);
      if (r > 1) { x /= r; y /= r; }
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)) * (drag.front ? 1 : -1);
      const az = (Math.atan2(x, z) * 180) / Math.PI, el = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
      const [a, b] = lampAnglesFor(s, az, el);
      s[drag.role] = { ...s[drag.role], azimuth: a, elevation: b };
    } else {
      s.yaw = wrap(s.yaw + (p.x - drag.x) * TURN);
      s.pitch = Math.max(-80, Math.min(80, s.pitch - (p.y - drag.y) * TURN));
      s.yaw = Math.round(s.yaw * 10) / 10;
      s.pitch = Math.round(s.pitch * 10) / 10;
      drag.x = p.x;
      drag.y = p.y;
    }
    change(s, false);
    draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    change(get(), true);
  };
  canvas.ondblclick = () => { change({ ...get(), yaw: 0, pitch: 0 }, true); draw(); };
  canvas.onkeydown = (e) => {
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 2, s = { ...get() };
    if (e.key === "ArrowLeft") s.yaw = wrap(s.yaw - step);
    if (e.key === "ArrowRight") s.yaw = wrap(s.yaw + step);
    if (e.key === "ArrowUp") s.pitch = Math.min(80, s.pitch + step);
    if (e.key === "ArrowDown") s.pitch = Math.max(-80, s.pitch - step);
    change(s, true);
    draw();
  };

  function draw() {
    const s = get();
    const key = JSON.stringify(s);
    if (key === drawn) return;
    drawn = key;
    // the ball, lit by the three lights (as the shader does it, roughly: a soft Lambert with a little shine) over the ambient
    const lamps = STUDIO_ROLES.filter((r) => s[r].on).map((r) => ({ d: lightDirection(...studioAngles(s, r)), c: lightColor(s[r].color, s[r].intensity * s.brightness) }));
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const nx = (x - C) / BALL, ny = (C - y) / BALL, rr = nx * nx + ny * ny;
      if (rr > 1) { pixels.data[i + 3] = 0; continue; }
      const nz = Math.sqrt(1 - rr);
      const rgb = [s.ambient, s.ambient, s.ambient];
      for (const { d, c } of lamps) {
        const dot = nx * d.x + ny * d.y + nz * d.z;
        const lit = Math.max(0, dot) * 0.85 + Math.pow(Math.max(0, dot), 24) * 0.3;
        rgb[0] += lit * c.x; rgb[1] += lit * c.y; rgb[2] += lit * c.z;
      }
      for (let k = 0; k < 3; k++) pixels.data[i + k] = Math.min(255, Math.pow(rgb[k] * 0.55, 1 / 2.2) * 255);
      // (a soft edge)
      pixels.data[i + 3] = Math.min(255, (1 - Math.sqrt(rr)) * BALL * 255);
    }
    bctx.putImageData(pixels, 0, 0);
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    // the pivot's horizon and meridian, faint: which way the rig is turned
    ctx.drawImage(ball, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(C, C, BALL, 0, Math.PI * 2);
    ctx.stroke();
    // the markers: behind ones first and faded, so that one in front is on top
    const marks = STUDIO_ROLES.map((role) => ({ role, ...markerOf(s, role) })).sort((a, b) => Number(a.front) - Number(b.front));
    for (const m of marks) {
      ctx.save();
      ctx.globalAlpha = (m.front ? 1 : 0.45) * (s[m.role].on ? 1 : 0.4);
      ctx.fillStyle = s[m.role].color;
      ctx.strokeStyle = "#15181c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#15181c";
      ctx.font = "700 10px Inter, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(STUDIO_LABELS[m.role][0], m.x, m.y + 0.5);
      ctx.restore();
    }
    canvas.setAttribute("aria-valuetext", `pivot ${Math.round(s.yaw)} degrees round, ${Math.round(s.pitch)} degrees over`);
  }
  return { element: canvas, draw };
}

const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
