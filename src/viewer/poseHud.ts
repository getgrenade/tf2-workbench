import { POSE_MAP, POSE_MAP_VIEWBOX } from "./poseMapData";
import type { LimbId } from "./poseRig";

/**
 * The pose mode controls drawn over the 3D view: an icon toolbar along the top, a body map on the left (a clickable Heavy-shaped figure
 * with an IK / FK switch beside every limb) and Only the DOM
 * is built here; `tab.ts` wires it to the rig.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
  show: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  mirror: '<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>',
  eye: '<circle cx="12" cy="12" r="7.500"/><circle cx="12" cy="12" r="2.200"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  orient: '<path d="M5 19V5M5 19h14M5 19l8-8"/>',
  groups: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2.200"/><circle cx="9" cy="12" r="2.200"/><circle cx="17" cy="18" r="2.200"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
  resetBone: '<path d="M3 12a9 9 0 1 0 3-6.700L3 8M3 3v5h5"/>',
  resetAll: '<path d="M4 4v6h6M20 20v-6h-6M20 10A8 8 0 0 0 6 6L4 10M4 14a8 8 0 0 0 14 4l2-4"/>',
  library: '<path d="M5 4h3v16H5zM10 4h3v16h-3zM16 6.500l3-.9 3 13.400-3 .9z"/>',
};

const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/** Where the IK / FK switch of each limb and the pole dot of its IK sit on the map (viewBox units). */
const LIMB_MARKS: Record<LimbId, { switchAt: [number, number]; poleAt: [number, number] }> = {
  armR: { switchAt: [118, 604], poleAt: [112, 318] },
  armL: { switchAt: [524, 604], poleAt: [530, 318] },
  legR: { switchAt: [146, 690], poleAt: [221, 606] },
  legL: { switchAt: [496, 690], poleAt: [421, 606] },
};

const MAP_POS_KEY = "tf2workbench.poseMapPos";

export interface PoseHud {
  root: HTMLElement;
  /** Toggles: real checkboxes inside button-like labels, so `.checked`, `.onchange` and `.disabled` work. */
  show: HTMLInputElement;
  mirror: HTMLInputElement;
  eye: HTMLInputElement;
  /** Cycles the gizmo between local and global. */
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  resetBone: HTMLButtonElement;
  resetAll: HTMLButtonElement;
  /** Shows the pose library (the docked Pose tab). */
  library: HTMLButtonElement;
  /** The block under the body map with a button per control group (`data-group`) and the toggle that shows or hides all the controls. */
  groups: HTMLElement;
  /** The body map panel (it can be dragged around the view) and a call to keep it inside the view after a resize. */
  mapPanel: HTMLElement;
  keepMapInside: () => void;
  /** The map regions, by part and side: `head`, `neck`, `chest`, `pelvis`, `shoulderL`, `handR` ... */
  regions: Map<string, SVGElement>;
  /** The IK / FK switch of each limb and the pole dot of its IK. */
  limbSwitch: Map<LimbId, SVGGElement>;
  poleDot: Map<LimbId, SVGElement>;
  /** A line under the toolbar for the hint of the transform in progress. */
  status: HTMLElement;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

function button(html: string, title: string, className = "phBtn"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.innerHTML = html;
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}

/** A toggle that looks like a toolbar button but is a checkbox underneath. */
function toggle(iconName: keyof typeof ICONS, title: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.className = "phBtn phToggle";
  label.title = title;
  const input = document.createElement("input");
  input.type = "checkbox";
  label.innerHTML = icon(iconName);
  label.prepend(input);
  return { label, input };
}

/** Builds the pose HUD into `host` (the 3D view's container). It starts hidden. */
export function createPoseHud(host: HTMLElement): PoseHud {
  const root = document.createElement("div");
  root.id = "poseHud";
  root.hidden = true;

  // --- the toolbar ---
  const bar = document.createElement("div");
  bar.className = "phBar";
  const show = toggle("show", "Show the controls on the character");
  show.input.checked = true;
  const mirror = toggle("mirror", "Mirror: repeat each edit on the other side of the body");
  const eye = toggle("eye", "Eye aim: make the eyes look at a target you can move");
  const undo = button(icon("undo"), "Undo (Ctrl+Z)");
  const redo = button(icon("redo"), "Redo (Ctrl+Y)");
  const resetBone = button(icon("resetBone"), "Reset the selected control (Alt+W position, Alt+E rotation, Alt+R scale)");
  const resetAll = button(icon("resetAll"), "Reset the whole pose to where posing started");
  const library = button(icon("library"), "Pose Library: save and load poses");
  const sep = () => Object.assign(document.createElement("span"), { className: "phSep" });
  bar.append(mirror.label, sep(), undo, redo, resetBone, resetAll, sep(), library);

  const groups = document.createElement("div");
  groups.className = "phPop";
  groups.innerHTML =
    '<div class="slotBtns">' +
    '<button data-group="spine" class="on" title="Head, neck, spine and pelvis">Body</button>' +
    '<button data-group="arm" class="on">Arms</button>' +
    '<button data-group="leg" class="on">Legs</button>' +
    '<button data-group="face" class="on">Face</button>' +
    '<button data-group="spinebones" title="The individual spine bones and the chest, as extra rings">Spine</button>' +
    '<button data-group="detail" title="The prp_ bones: pouches, grenades, coat and collar pieces">Detail</button>' +
    '<button data-group="weapon" title="The weapon_ bones the held weapon rides on">Weapon</button>' +
    '<button data-group="prop" title="The prop_ bones that taunt props ride on">Prop</button>' +
    '<button data-group="fingers" class="on" title="One curl control per finger">Fingers</button>' +
    '<button data-group="fingerbones" title="Every finger bone, for fine tuning">Finger joints</button></div>';
  // the eye that shows or hides all the controls and the eye aim lead the buttons of the groups
  // (eye aim is a word, like the buttons next to it, not an icon)
  eye.label.classList.add("phChip");
  show.label.classList.add("phChip");
  eye.label.querySelector("svg")!.replaceWith(document.createTextNode("Eyes"));
  groups.querySelector(".slotBtns")!.prepend(show.label, eye.label);

  // --- the body map: a panel with a handle (drag it anywhere over the view) and the show-controls toggle ---
  const map = document.createElement("div");
  map.className = "phMap";
  const head = document.createElement("div");
  head.className = "phMapHead";
  head.title = "Drag to move this panel";
  head.innerHTML = '<span class="phGrip" aria-hidden="true"></span><span class="phMapTitle">Pose</span>';
  map.appendChild(head);
  const regions = new Map<string, SVGElement>();
  const limbSwitch = new Map<LimbId, SVGGElement>();
  const poleDot = new Map<LimbId, SVGElement>();
  const figure = svg("svg", { viewBox: POSE_MAP_VIEWBOX, role: "group", "aria-label": "Body map: click a part to select its control" }, map);
  for (const part of POSE_MAP) {
    const g = svg("g", { class: "phPart" }, figure);
    g.dataset.region = part.key;
    svg("title", {}, g).textContent = part.label;
    for (const points of part.polygons) svg("polygon", { points }, g);
    regions.set(part.key, g);
  }
  for (const limb of Object.keys(LIMB_MARKS) as LimbId[]) {
    const marks = LIMB_MARKS[limb];
    const kind = limb.startsWith("arm") ? "arm" : "leg";
    const side = limb.slice(-1);
    const dot = svg("circle", { cx: marks.poleAt[0], cy: marks.poleAt[1], r: 15, class: "phPole" }, figure);
    svg("title", {}, dot).textContent = `${side === "R" ? "Right" : "Left"} ${kind} pole: where the ${kind === "arm" ? "elbow" : "knee"} points`;
    dot.dataset.region = `pole${kind === "arm" ? "Arm" : "Leg"}${side}`;
    regions.set(dot.dataset.region, dot);
    poleDot.set(limb, dot);
    const sw = svg("g", { class: "phSwitch", transform: `translate(${marks.switchAt[0]} ${marks.switchAt[1]})` }, figure);
    svg("rect", { x: -40, y: -24, width: 80, height: 48, rx: 12 }, sw);
    svg("text", { x: 0, y: 12, "text-anchor": "middle" }, sw).textContent = "FK";
    sw.dataset.limb = limb;
    limbSwitch.set(limb, sw);
  }

  map.appendChild(groups);

  // dragging the panel by its handle; the place is remembered
  let pos: { x: number; y: number } | null = null;
  try {
    pos = JSON.parse(localStorage.getItem(MAP_POS_KEY) ?? "null");
  } catch {
    pos = null;
  }
  const place = (x: number, y: number) => {
    const bounds = root.getBoundingClientRect();
    const px = Math.max(0, Math.min(x, Math.max(0, bounds.width - map.offsetWidth)));
    const py = Math.max(0, Math.min(y, Math.max(0, bounds.height - map.offsetHeight)));
    map.style.left = `${px}px`;
    map.style.top = `${py}px`;
    return { x: px, y: py };
  };
  const keepMapInside = () => {
    if (root.hidden) return;
    const left = parseFloat(map.style.left || "56");
    const top = parseFloat(map.style.top || "44");
    place(left, top);
  };
  if (pos) {
    map.style.left = `${pos.x}px`;
    map.style.top = `${pos.y}px`;
  }
  head.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest(".phToggle, button") || ev.button !== 0) return;
    const bounds = root.getBoundingClientRect();
    const dx = ev.clientX - bounds.left - map.offsetLeft;
    const dy = ev.clientY - bounds.top - map.offsetTop;
    head.setPointerCapture(ev.pointerId);
    head.classList.add("dragging");
    const move = (e: PointerEvent) => place(e.clientX - bounds.left - dx, e.clientY - bounds.top - dy);
    const up = (e: PointerEvent) => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      head.classList.remove("dragging");
      const p = place(e.clientX - bounds.left - dx, e.clientY - bounds.top - dy);
      try {
        localStorage.setItem(MAP_POS_KEY, JSON.stringify(p));
      } catch {
        // not remembered
      }
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
    ev.preventDefault();
  });
  window.addEventListener("resize", keepMapInside);

  const status = document.createElement("div");
  status.className = "phStatus";

  root.append(bar, status, map);
  host.appendChild(root);
  return { root, show: show.input, mirror: mirror.input, eye: eye.input, undo, redo, resetBone, resetAll, library, groups, mapPanel: map, keepMapInside, regions, limbSwitch, poleDot, status };
}
