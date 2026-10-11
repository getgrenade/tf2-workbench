import * as THREE from "three";

/**
 * The navigation widgets in the top right corner of the 3D view, like Blender's: an axis gizmo that shows how the world is oriented and
 * snaps the view to an axis when a ball is clicked, and under it a column of round buttons: a magnifier you drag up and down to zoom, a hand
 * you drag to pan, a camera that looks through the last camera you picked (and back out), and a grid that turns between a perspective and
 * an orthographic view.
 * The axes are the game's own (x forward, y left, z up), which are (z, x, y) of the viewer's space.
 */

export interface NavHost {
  camera: THREE.Camera;
  /** The unit direction from what the camera looks at to the camera. */
  viewDir(): THREE.Vector3;
  /** Looks at the scene along `-dir` (the camera goes to the `dir` side). */
  snapTo(dir: THREE.Vector3): void;
  /** Turns the camera about what it looks at by a mouse movement in pixels (dragging the gizmo). */
  orbitBy(dx: number, dy: number): void;
  /** Zooms by a factor (below 1 closer, above 1 further away). */
  zoomBy(factor: number): void;
  /** Pans by a mouse movement in pixels. */
  panBy(dx: number, dy: number): void;
  toggleProjection(): void;
  isOrthographic(): boolean;
  /** How many cameras the scene has (the camera button needs one). */
  cameraCount(): number;
  /** True while the view is through a camera. */
  cameraActive(): boolean;
  /** Looks through the last camera that was picked, or leaves the camera view. */
  toggleCamera(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SIZE = 96;
const C = SIZE / 2;
const R = 31;

const AXES = [
  { label: "X", dir: new THREE.Vector3(0, 0, 1), color: "#e5483f" },
  { label: "Y", dir: new THREE.Vector3(1, 0, 0), color: "#7fb92a" },
  { label: "Z", dir: new THREE.Vector3(0, 1, 0), color: "#3b82e0" },
];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const ZOOM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500 21 21M10.500 7.500v6M7.500 10.500h6"/></svg>';
const HAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.500a1.500 1.500 0 0 1 3 0V11M11 10.500V4.500a1.500 1.500 0 0 1 3 0V11M14 10.500V6a1.500 1.500 0 0 1 3 0v8c0 4-2 7-6 7-3 0-4.500-1.500-6-4l-1.500-3a1.500 1.500 0 0 1 2.500-1.500L8 14"/></svg>';

const CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="6.500" r="2.800"/><circle cx="13.500" cy="6.500" r="2.800"/><rect x="3" y="10" width="12.500" height="9" rx="1.800"/><path d="M15.500 13.500 21 11v8l-5.500-2.500"/></svg>';
/** A grid seen in perspective (the way the view is now), and a flat one (an orthographic view). */
const PERSPECTIVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h10l4 14H3zM10.300 5 9 19M13.700 5 15 19M5.700 9.700h12.600M4.300 14.300h15.400"/></svg>';
const ORTHOGRAPHIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4zM9.300 4v16M14.700 4v16M4 9.300h16M4 14.700h16"/></svg>';

/** Builds the widgets into `parent`; call `update` every frame to keep the axes turned with the camera. */
export function createNavGizmo(parent: HTMLElement, host: NavHost): { update: () => void } {
  const box = document.createElement("div");
  box.id = "navTools";

  // --- the axis gizmo ---
  const svg = el("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, role: "group", "aria-label": "View orientation: click an axis to look along it" });
  svg.classList.add("navAxes");
  el("circle", { cx: C, cy: C, r: C - 2, class: "navBack" }, svg);
  const nodes = AXES.flatMap((a) =>
    [1, -1].map((sign) => {
      const g = el("g", { class: "navBall" + (sign < 0 ? " neg" : "") }, svg);
      const line = sign > 0 ? el("line", { x1: C, y1: C, x2: C, y2: C, stroke: a.color, "stroke-width": 2.5, "stroke-linecap": "round" }, g) : null;
      const circle = el("circle", { r: sign > 0 ? 8.5 : 6.5, fill: a.color, stroke: a.color }, g);
      const text = sign > 0 ? el("text", { "text-anchor": "middle", dy: "0.35em" }, g) : null;
      if (text) text.textContent = a.label;
      const dir = a.dir.clone().multiplyScalar(sign);
      g.dataset.axis = String(AXES.indexOf(a) * 2 + (sign > 0 ? 0 : 1));
      const title = el("title", {}, g);
      title.textContent = `${sign > 0 ? "" : "-"}${a.label}: look ${sign > 0 ? "from the " + a.label + " side" : "from the opposite side"}`;
      return { g, line, circle, text, dir };
    }),
  );
  // Press on a ball and release without moving: the view goes to that axis (or, when it already is that axis, to the opposite side, front to
  // back and top to bottom, like Blender's). Press anywhere on the gizmo (a ball or the grey disc) and drag: the view orbits.
  // The pointer is captured by the gizmo, so the balls being re-ordered under it does not matter.
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    const ball = (ev.target as Element).closest<SVGGElement>("g.navBall");
    const pressed = ball ? nodes[Number(ball.dataset.axis)] : null;
    const start = { x: ev.clientX, y: ev.clientY };
    let last = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    const onMove = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      if (!moved) {
        moved = true;
        svg.classList.add("dragging");
      }
      host.orbitBy(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      svg.classList.remove("dragging");
      if (!moved && pressed) host.snapTo(host.viewDir().dot(pressed.dir) > 0.995 ? pressed.dir.clone().negate() : pressed.dir);
    };
    last = start;
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
  });
  el("title", {}, svg).textContent = "Click an axis to look along it (click it again for the opposite side); drag to turn the view";
  box.appendChild(svg);

  // --- the buttons sit in one slim pill under the gizmo, as in Blender ---
  const pill = document.createElement("div");
  pill.className = "navPill";
  box.appendChild(pill);
  // zoom and pan: press the button and drag
  const drag = (html: string, title: string, cls: string, move: (dx: number, dy: number) => void) => {
    const b = document.createElement("button");
    b.className = `navBtn ${cls}`;
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      b.setPointerCapture(ev.pointerId);
      b.classList.add("on");
      let last = { x: ev.clientX, y: ev.clientY };
      const onMove = (e: PointerEvent) => {
        move(e.clientX - last.x, e.clientY - last.y);
        last = { x: e.clientX, y: e.clientY };
      };
      const onUp = () => {
        b.classList.remove("on");
        b.removeEventListener("pointermove", onMove);
        b.removeEventListener("pointerup", onUp);
        b.removeEventListener("pointercancel", onUp);
      };
      b.addEventListener("pointermove", onMove);
      b.addEventListener("pointerup", onUp);
      b.addEventListener("pointercancel", onUp);
    });
    pill.appendChild(b);
  };
  drag(ZOOM_ICON, "Zoom: drag up or down (mouse wheel works too)", "zoom", (_dx, dy) => host.zoomBy(Math.exp(dy * 0.01)));
  drag(HAND_ICON, "Pan: drag to move the view (right mouse button drag works too)", "pan", (dx, dy) => host.panBy(dx, dy));
  const camera = document.createElement("button");
  camera.className = "navBtn camera";
  camera.innerHTML = CAMERA_ICON;
  camera.onclick = () => host.toggleCamera();
  pill.appendChild(camera);
  const projection = document.createElement("button");
  projection.className = "navBtn projection";
  projection.innerHTML = PERSPECTIVE_ICON;
  projection.onclick = () => host.toggleProjection();
  pill.appendChild(projection);
  parent.appendChild(box);

  let lastOrder: typeof nodes = [];
  const inverse = new THREE.Quaternion();
  const v = new THREE.Vector3();
  return {
    update() {
      const orthographic = host.isOrthographic();
      if (projection.dataset.ortho !== String(orthographic)) {
        projection.dataset.ortho = String(orthographic);
        projection.innerHTML = orthographic ? ORTHOGRAPHIC_ICON : PERSPECTIVE_ICON;
      }
      const cameras = host.cameraCount(), through = host.cameraActive();
      camera.disabled = cameras === 0;
      camera.classList.toggle("on", through);
      camera.title = cameras === 0 ? "No camera in the scene (add one with + Add in the outliner)" : through ? "Leave the camera view" : "Look through the last camera you picked";
      camera.setAttribute("aria-label", camera.title); camera.setAttribute("aria-pressed", String(through));
      projection.title = orthographic ? "Orthographic view: switch to perspective" : "Perspective view: switch to orthographic";
      projection.setAttribute("aria-label", projection.title); projection.setAttribute("aria-pressed", String(orthographic));
      host.camera.updateMatrixWorld();
      inverse.copy(host.camera.quaternion).invert();
      const placed = nodes.map((n) => {
        v.copy(n.dir).applyQuaternion(inverse);
        return { n, x: C + v.x * R, y: C - v.y * R, z: v.z };
      });
      // far balls first, so near ones are drawn over them
      placed.sort((a, b) => a.z - b.z);
      for (const { n, x, y, z } of placed) {
        n.g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        n.g.style.opacity = String(z < -0.05 && n.g.classList.contains("neg") ? 0.55 : 1);
        if (n.line) {
          n.line.setAttribute("x2", String((C - x).toFixed(1)));
          n.line.setAttribute("y2", String((C - y).toFixed(1)));
          n.line.setAttribute("x1", "0");
          n.line.setAttribute("y1", "0");
        }
      }
      // the drawing order (far balls first) only changes the DOM when the order itself changes
      const order = placed.map((p) => p.n);
      if (order.some((n, i) => n !== lastOrder[i])) {
        for (const n of order) svg.appendChild(n.g);
        lastOrder = order;
      }
    },
  };
}
