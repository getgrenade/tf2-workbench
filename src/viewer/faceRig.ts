import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Actor } from "./actor";
import { flexKey, flexRamp, runFlexRules, type FlexGlobals } from "./flex";
import type { ModelData } from "./payload";

/**
 * The face rig of an HWM model (models/player/hwm: SFM's high-detail heads): on-face controls, as an animator's face rig has them, in
 * place of the long list of flex sliders. Each control is a small joystick in a box on the part of the face it moves: up and down drive
 * one flex, sideways another (the box shows how far each way goes), and a selected control lists all its flexes as sliders in a channel
 * box, the ones the joystick drives and the finer ones it does not (a lip's roll and puff, the jaw's thrust).
 *
 * Nothing is placed by hand: each control stands where its flexes move the face most (worked out from the model's own flex deltas, at
 * rest), and which way a flex goes on its axis is read from the same deltas, so the one layout fits all nine HWM heads.
 */

/** One flex a control drives: on an axis of its joystick (`dir`: which half, +1 up / outward, -1 down / inward; auto from the deltas when
 * left out), or only in its channel box (`axis` "extra"). */
interface ChannelDef { flex: string; axis: "x" | "y" | "extra"; dir?: 1 | -1 }
interface ControlDef {
  id: string;
  label: string;
  /** The flex whose movement places the control (where it moves the face most at its full value). */
  anchor: string;
  channels: ChannelDef[];
  /** How far out in front of the face it stands (half eye spans; the eyes' aim). */
  ahead?: number;
  /** How far its joystick goes, times the others' (the eyes' aim: a wider sweep for a finer aim). */
  travel?: number;
  /** Where it sits on the face, from the face's landmarks: x outward from the middle and y up from the eyes, in half eye spans. */
  at: (f: Landmarks) => [number, number];
}
/** The face's landmarks, in half eye spans (x outward from the middle of the face, y up from the eyes): read from where the flexes move it. */
interface Landmarks { eye: number; brow: number; nose: number; lipUp: number; lipLo: number; cornerX: number; cornerY: number }

/** The controls of one side (left_ / right_ flexes), mirrored on the other. */
const SIDE: ControlDef[] = [
  { id: "scalp", label: "Scalp", anchor: "ScalpD", channels: [{ flex: "ScalpD", axis: "y" }], at: (f) => [0.85, f.brow + 0.95] },
  { id: "browIn", label: "Inner brow", anchor: "BrowInV", channels: [{ flex: "BrowInV", axis: "y" }, { flex: "Frown", axis: "x", dir: -1 }], at: (f) => [0.4, f.brow + 0.3] },
  { id: "browOut", label: "Outer brow", anchor: "BrowOutV", channels: [{ flex: "BrowOutV", axis: "y" }], at: (f) => [1.3, f.brow + 0.25] },
  { id: "lid", label: "Eyelid", anchor: "CloseLid", channels: [{ flex: "CloseLid", axis: "y" }], at: (f) => [f.eye, 0] },
  // (the squints apart, under the eye's corners: both can be on at once; up raises the lower lid)
  { id: "squintIn", label: "Inner squint", anchor: "InnerSquint", channels: [{ flex: "InnerSquint", axis: "y", dir: 1 }], at: (f) => [f.eye - 0.42, -0.36] },
  { id: "squintOut", label: "Outer squint", anchor: "OuterSquint", channels: [{ flex: "OuterSquint", axis: "y", dir: 1 }], at: (f) => [f.eye + 0.42, -0.36] },
  { id: "nose", label: "Nose", anchor: "NoseV", channels: [{ flex: "NoseV", axis: "y" }, { flex: "NostrilFlare", axis: "x" }], at: (f) => [0.38, f.nose] },
  { id: "cheek", label: "Cheek", anchor: "CheekV", channels: [{ flex: "CheekV", axis: "y" }, { flex: "CheekH", axis: "x" }], at: (f) => [1.25, f.nose - 0.05] },
  { id: "lipUp", label: "Upper lip", anchor: "LipUpV", channels: [{ flex: "LipUpV", axis: "y" }, { flex: "PuckerLipUp", axis: "x", dir: -1 }, { flex: "FoldLipUp", axis: "extra" }, { flex: "PuffLipUp", axis: "extra" }], at: (f) => [0.32, Math.max(f.lipUp + 0.18, f.cornerY + 0.4)] },
  { id: "corner", label: "Mouth corner", anchor: "Smile", channels: [{ flex: "Smile", axis: "y", dir: 1 }, { flex: "Platysmus", axis: "y", dir: -1 }, { flex: "Dimple", axis: "x" }, { flex: "LipCnrTwst", axis: "extra" }], at: (f) => [f.cornerX + 0.3, f.cornerY] },
  { id: "lipLo", label: "Lower lip", anchor: "LipLoV", channels: [{ flex: "LipLoV", axis: "y" }, { flex: "PuckerLipLo", axis: "x", dir: -1 }, { flex: "FoldLipLo", axis: "extra" }, { flex: "PuffLipLo", axis: "extra" }], at: (f) => [0.32, Math.min(f.lipLo - 0.22, f.cornerY - 0.4)] },
];
/** The controls on the middle of the face. */
const CENTER: ControlDef[] = [
  // (where the eyes look, out in front of them as an animator's rig has it: eyes_rightleft and eyes_updown, in degrees, on top of the
  // camera when the eyes follow it; it stands at the brows' depth plus `ahead`)
  { id: "eyes", label: "Eyes aim", anchor: "left_BrowInV", ahead: 2.8, travel: 2.2, channels: [{ flex: "eyes_rightleft", axis: "x", dir: 1 }, { flex: "eyes_updown", axis: "y", dir: -1 }], at: () => [0, 0.05] },
  // (down opens the mouth: the jaw drops and the lips part with it, LipsV; up clenches it, the lips pressed)
  { id: "jaw", label: "Jaw", anchor: "JawV", channels: [{ flex: "JawV", axis: "y" }, { flex: "left_LipsV", axis: "y", dir: -1 }, { flex: "right_LipsV", axis: "y", dir: -1 }, { flex: "JawH", axis: "x" }, { flex: "JawD", axis: "extra" }], at: (f) => [0, Math.min(f.lipLo - 0.95, f.cornerY - 1.2)] },
];

/** A channel of a placed control: a real controller of the model. */
export interface FaceChannel {
  /** The controller's name (as the model has it) and its range. */
  name: string;
  min: number;
  max: number;
  axis: "x" | "y" | "extra";
  /** Which way along the axis gives the controller's positive values. */
  dir: 1 | -1;
  /** The same flex on the other side (mirror), when it has one. */
  mirror: string | null;
}
export interface FaceControl {
  id: string;
  label: string;
  side: "L" | "R" | "C";
  /** Where it sits on the face, in the model's bind space, and the head bone that carries it. */
  origin: THREE.Vector3;
  bone: number;
  /** Its axes in bind space: x outward (the character's left for a middle one), y up; z out of the face. Unit length. */
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  /** Half the box's size (bind units). */
  size: number;
  /** Whether the joystick goes each way: [-x, +x, -y, +y]. */
  reach: [boolean, boolean, boolean, boolean];
  channels: FaceChannel[];
}
export interface FaceLayout {
  controls: FaceControl[];
  /** The middle of the face (bind space) and the way out of it, to look at it straight on; `span`: how tall the rig is. */
  middle: THREE.Vector3;
  out: THREE.Vector3;
  span: number;
}

/** Where a set of flex weights moves the model's vertices: per mesh vertex, xyz. */
function displacement(model: ModelData, weights: Float32Array): { mesh: Float32Array; pos: Float32Array }[] {
  const out: { mesh: Float32Array; pos: Float32Array }[] = [];
  for (const bp of model.bodyParts) for (const sub of bp.models) for (const mesh of sub.meshes) {
    if (!mesh.flexes.length) continue;
    const d = new Float32Array(mesh.positions.length);
    for (const f of mesh.flexes) {
      const w = flexRamp(weights[f.desc] ?? 0, f.targets);
      const sides = f.pair != null ? f.sides : undefined;
      const w2 = sides ? flexRamp(weights[f.pair!] ?? 0, f.targets) : 0;
      if (Math.abs(w) < 1e-4 && Math.abs(w2) < 1e-4) continue;
      for (let i = 0; i < f.vertices.length; i++) {
        let s = w;
        if (sides) { const b = sides[i] / 255; s = w * (1 - b) + w2 * b; }
        const v = f.vertices[i] * 3;
        d[v] += s * f.deltas[i * 3];
        d[v + 1] += s * f.deltas[i * 3 + 1];
        d[v + 2] += s * f.deltas[i * 3 + 2];
      }
    }
    out.push({ mesh: d, pos: mesh.positions });
  }
  return out;
}

/** What one controller at one value does to the face: where it moves it (weighted by how far) and which way on average; null for nothing. */
interface Effect { at: THREE.Vector3; way: THREE.Vector3; amount: number }

/**
 * Works out the face rig of a model: null when it is not an HWM head (it lacks the controllers the rig drives). `head`: the bone the face
 * is skinned to.
 */
export function analyzeFace(model: ModelData, head: number): FaceLayout | null {
  const byKey = new Map(model.flexControllers.map((c) => [flexKey(c.name), c]));
  const has = (n: string) => byKey.has(flexKey(n));
  if (!["left_Smile", "right_Smile", "JawV", "left_BrowInV", "right_BrowInV"].every(has)) return null;
  const zero: FlexGlobals = new Map(model.flexControllers.map((c) => [flexKey(c.name), 0]));
  const rest = displacement(model, runFlexRules(model, zero));
  const effect = (name: string, value: number): Effect | null => {
    const g = new Map(zero);
    g.set(flexKey(name), value);
    const moved = displacement(model, runFlexRules(model, g));
    const at = new THREE.Vector3(), way = new THREE.Vector3();
    let weight = 0;
    moved.forEach(({ mesh, pos }, m) => {
      const base = rest[m]?.mesh;
      for (let v = 0; v < mesh.length; v += 3) {
        const dx = mesh[v] - (base?.[v] ?? 0), dy = mesh[v + 1] - (base?.[v + 1] ?? 0), dz = mesh[v + 2] - (base?.[v + 2] ?? 0);
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.01) continue;
        // (the parts that move most count most: a control sits where its flex shows)
        const k = len * len;
        weight += k;
        at.x += k * pos[v]; at.y += k * pos[v + 1]; at.z += k * pos[v + 2];
        way.x += len * dx; way.y += len * dy; way.z += len * dz;
      }
    });
    if (!weight) return null;
    return { at: at.divideScalar(weight), way: way.divideScalar(weight), amount: weight };
  };
  const full = (name: string) => { const c = byKey.get(flexKey(name)); return c ? effect(c.name, c.max) : null; };

  // the face's own axes: across from the right mouth corner to the left one, up from the mouth to the brows, and out of the face
  const smileL = full("left_Smile"), smileR = full("right_Smile"), browL = full("left_BrowInV"), browR = full("right_BrowInV"), jaw = full("JawV");
  if (!smileL || !smileR || !browL || !browR || !jaw) return null;
  const across = smileL.at.clone().sub(smileR.at).normalize();
  const up = browL.at.clone().add(browR.at).multiplyScalar(0.5).sub(smileL.at.clone().add(smileR.at).multiplyScalar(0.5));
  up.addScaledVector(across, -up.dot(across)).normalize();
  const out = new THREE.Vector3().crossVectors(across, up);
  // (out of the face: the brows are in front of the head bone, at the top of the neck, whatever way the model's bind space turns; the mouth
  // or the brows alone, or the middle of the face's mesh, would not do: a Heavy's brows stand out past his mouth, a Sniper's face mesh is
  // the face alone)
  const b = model.bones[head]?.poseToBone;
  if (b && b.length >= 12) {
    // the bone's place in bind space: -R^T t of its world -> bone transform
    const neck = new THREE.Vector3(
      -(b[0] * b[3] + b[4] * b[7] + b[8] * b[11]),
      -(b[1] * b[3] + b[5] * b[7] + b[9] * b[11]),
      -(b[2] * b[3] + b[6] * b[7] + b[10] * b[11]),
    );
    if (browL.at.clone().add(browR.at).multiplyScalar(0.5).sub(neck).dot(out) < 0) out.negate();
  }
  // the face's landmarks (see Landmarks), from the middle of the eyes
  const lidL = full("left_CloseLid") , lidR = full("right_CloseLid");
  const eyeL = (lidL ?? browL).at, eyeR = (lidR ?? browR).at;
  const middle = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  const half = Math.max(0.5, eyeL.clone().sub(middle).dot(across));
  const X = (p: THREE.Vector3) => p.clone().sub(middle).dot(across) / half;
  const Y = (p: THREE.Vector3) => p.clone().sub(middle).dot(up) / half;
  const Z = (p: THREE.Vector3) => p.clone().sub(middle).dot(out);
  const yOf = (n: string, fallback: number) => { const e = byKey.has(flexKey(n)) ? full(n) : null; return e ? Y(e.at) : fallback; };
  const marks: Landmarks = {
    eye: X(eyeL),
    brow: Y(browL.at),
    nose: yOf("left_NoseV", -0.9),
    lipUp: yOf("left_LipUpV", -1.4),
    lipLo: yOf("left_LipLoV", -1.8),
    cornerX: X(smileL.at),
    cornerY: Y(smileL.at),
  };
  // the box size: a fraction of the half eye span
  const size = half * 0.17;

  const controls: FaceControl[] = [];
  const place = (def: ControlDef, side: "L" | "R" | "C") => {
    const prefix = side === "L" ? "left_" : side === "R" ? "right_" : "";
    const other = side === "L" ? "right_" : side === "R" ? "left_" : "";
    const name = (f: string) => byKey.get(flexKey(prefix + f))?.name ?? byKey.get(flexKey(f))?.name ?? null;
    const anchorName = name(def.anchor);
    if (!anchorName) return;
    const anchor = full(anchorName);
    if (!anchor) return;
    const x = side === "R" ? across.clone().negate() : across.clone();
    const channels: FaceChannel[] = [];
    for (const ch of def.channels) {
      const n = name(ch.flex);
      if (!n) continue;
      const c = byKey.get(flexKey(n))!;
      let dir = ch.dir;
      if (!dir && ch.axis !== "extra") {
        const e = full(n);
        const axis = ch.axis === "x" ? x : up;
        dir = e && e.way.dot(axis) < 0 ? -1 : 1;
      }
      channels.push({ name: c.name, min: c.min, max: c.max, axis: ch.axis, dir: dir ?? 1, mirror: other ? byKey.get(flexKey(other + ch.flex))?.name ?? null : null });
    }
    if (!channels.length) return;
    // a two-way flex goes both ways on its axis; a one-way one only its own half
    const reach = (axis: "x" | "y", d: 1 | -1) => channels.some((c) => c.axis === axis && (c.min < 0 || c.dir === d));
    // on the layout's place, at the depth of the skin its flex moves (and a little in front of it)
    const [lx, ly] = def.at(marks);
    const origin = middle.clone()
      .addScaledVector(x, lx * half)
      .addScaledVector(up, ly * half)
      .addScaledVector(out, Z(anchor.at) + size * 1.2 + (def.ahead ?? 0) * half);
    controls.push({ id: side === "C" ? def.id : `${def.id}${side}`, label: side === "C" ? def.label : `${def.label} ${side}`, side, origin, bone: head, x, y: up.clone(), z: out.clone(), size: size * (def.travel ?? 1), reach: [reach("x", -1), reach("x", 1), reach("y", -1), reach("y", 1)], channels });
  };
  for (const def of SIDE) { place(def, "L"); place(def, "R"); }
  for (const def of CENTER) place(def, "C");
  const ys = controls.map((c) => c.origin.clone().sub(middle).dot(up));
  const low = Math.min(...ys), high = Math.max(...ys);
  return controls.length ? { controls, middle: middle.clone().addScaledVector(up, (low + high) / 2), out, span: high - low + size * 4 } : null;
}

/** Where the joystick of an axis stands (-1..1) for the controllers' values: the furthest of its flexes (one per half, or several that
 * move together, the jaw's). */
export function axisPosition(channels: FaceChannel[], axis: "x" | "y", get: (name: string) => number): number {
  let u = 0;
  for (const c of channels) {
    if (c.axis !== axis) continue;
    const v = get(c.name);
    const t = (v >= 0 ? (c.max > 0 ? v / c.max : 0) : (c.min < 0 ? -v / c.min : 0)) * c.dir;
    if (Math.abs(t) > Math.abs(u)) u = t;
  }
  return Math.max(-1, Math.min(1, u));
}

/** The controllers' values for a joystick position on an axis (-1..1). */
export function axisValues(channels: FaceChannel[], axis: "x" | "y", u: number): [FaceChannel, number][] {
  const out: [FaceChannel, number][] = [];
  for (const c of channels) {
    if (c.axis !== axis) continue;
    const t = u * c.dir;
    out.push([c, t >= 0 ? t * c.max : c.min < 0 ? -t * c.min : 0]);
  }
  return out;
}

const COLORS = { L: 0x3a8dff, R: 0xff3b30, C: 0xffc233 } as const;
const HOVER = 0xffffff;
const SELECTED = 0xff8a1f;
/** How close (in pixels) a click must be to a joystick to take it. */
const PICK_RADIUS = 8;

/** A closed outline (box units, a control's plane), as an animator's face rig draws its controls. */
type Outline = [number, number][];
const ellipse = (rx: number, ry: number, cx = 0, cy = 0, n = 36): Outline =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry]);
/** An eye's shape: two arcs meeting at the corners. */
const almond = (rx: number, ry: number, n = 40): Outline =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * ry * (0.55 + 0.45 * Math.abs(Math.sin(a)))];
  });
/** A bent bar (the scalp's, the jaw's): an arc `bend` high across `w` each way, `t` thick. */
const bar = (w: number, t: number, bend: number, n = 16): Outline => {
  const mid = (x: number) => bend * (1 - (x / w) ** 2);
  const top: Outline = [], bottom: Outline = [];
  for (let i = 0; i <= n; i++) {
    const x = -w + (2 * w * i) / n;
    top.push([x, mid(x) + t]);
    bottom.push([x, mid(x) - t]);
  }
  const cap = (x: number, from: number, to: number): Outline =>
    Array.from({ length: 6 }, (_, i) => {
      const a = from + ((to - from) * (i + 1)) / 7;
      return [x + Math.cos(a) * t, mid(x) + Math.sin(a) * t];
    });
  return [...top, ...cap(w, Math.PI / 2, -Math.PI / 2), ...bottom.reverse(), ...cap(-w, -Math.PI / 2, -Math.PI * 1.5)];
};
/** The outlines of each kind of control (by its id without the side), in box units (the joystick reaches 1 each way). */
const SHAPES: Record<string, Outline[]> = {
  scalp: [bar(1.9, 0.32, 0.45)],
  browIn: [ellipse(0.62, 0.62)],
  browOut: [ellipse(0.62, 0.62)],
  lid: [almond(2.3, 1.15)],
  squintIn: [bar(0.75, 0.24, 0)],
  squintOut: [bar(0.75, 0.24, 0)],
  // (the eyes' aim, out in front of the face: two eyes in a capsule)
  eyes: [bar(1, 0.42, 0), ellipse(0.28, 0.28, -0.58, 0), ellipse(0.28, 0.28, 0.58, 0)],
  nose: [ellipse(0.5, 0.5)],
  cheek: [ellipse(1.05, 1.05)],
  lipUp: [ellipse(0.5, 0.5)],
  lipLo: [ellipse(0.5, 0.5)],
  // (the corner moves every way: a ring with a dot)
  corner: [ellipse(0.62, 0.62), ellipse(0.16, 0.16, 0, 0, 12)],
  jaw: [bar(2.2, 0.36, -0.7)],
};
/**
 * The controls drawn as what they do instead of moved about (by the joystick's place, -1..1 each way): the eyelid opens as it is dragged
 * up (a little past its rest) and shuts as it is dragged down.
 */
const MORPHS: Record<string, (u: number, v: number) => Outline[]> = {
  lid: (_u, v) => {
    const open = v >= 0 ? 1 + 0.3 * v : 1 + 1.9 * v;
    return [almond(2.3, 1.15).map(([x, y]) => [x, y > 0 ? y * open : y] as [number, number])];
  },
};

/** A band along a closed outline, `w` wide (a line drawn as a mesh: GL draws lines one pixel wide). */
function band(outline: Outline, w: number): { pos: number[]; index: number[] } {
  const pos: number[] = [], index: number[] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = outline[(i + n - 1) % n], [x, y] = outline[i], [nx, ny] = outline[(i + 1) % n];
    // the normal at the point: the mean of its two segments'
    let ax = -(y - py), ay = x - px, bx = -(ny - y), by = nx - x;
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    let mx = ax + bx, my = ay + by;
    const lm = Math.hypot(mx, my) || 1;
    mx /= lm; my /= lm;
    const k = w / 2 / Math.max(0.35, mx * ax + my * ay);
    pos.push(x + mx * k, y + my * k, 0, x - mx * k, y - my * k, 0);
    const a = i * 2, b = ((i + 1) % n) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { pos, index };
}
/** The bands of several outlines in one geometry. */
function bands(outlines: Outline[], w: number): THREE.BufferGeometry {
  const pos: number[] = [], index: number[] = [];
  for (const o of outlines) {
    const b = band(o, w), base = pos.length / 3;
    pos.push(...b.pos);
    for (const i of b.index) index.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}
/** Whether a point is inside a polygon (screen points). */
function inside(x: number, y: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** How far a point is from a closed polyline (screen points). */
function edgeDistance(x: number, y: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

interface Drawn {
  control: FaceControl;
  group: THREE.Group;
  /** The range the control moves in (shown while it is hovered, selected or dragged). */
  box: THREE.LineSegments;
  /** The control itself: its outlines, moved by the joystick. */
  knob: THREE.Group;
  shape: THREE.Mesh;
  shadow: THREE.Mesh;
  dot: THREE.Mesh;
  outlines: Outline[];
  /** Where it is taken (its rest shape for one drawn as what it does: a shut eyelid is a line, the open eye is still its place). */
  hit: Outline[];
  /** The joystick's place (-1..1 each way) the shape was last drawn for. */
  u: number;
  v: number;
  /** Draws the shape for the joystick's place, when it is drawn as what it does (see MORPHS). */
  morph?: (u: number, v: number) => Outline[];
}

export interface FaceRigHooks {
  /** A controller's value (real units). */
  get(name: string): number;
  /** Sets controllers (real units) and applies them. */
  set(values: [string, number][]): void;
}

/**
 * The face rig drawn over a character: its controls, picked and dragged in the view (a drag moves the joystick in its box, which sets the
 * flexes), and the selected control's channel box.
 */
export class FaceRig {
  actor: Actor | null = null;
  private layout: FaceLayout | null = null;
  private drawn: Drawn[] = [];
  private readonly root = new THREE.Group();
  private selected: string | null = null;
  private hovered: string | null = null;
  private drag: { d: Drawn; plane: THREE.Plane; grab: THREE.Vector2; start: THREE.Vector2; pointer: number } | null = null;
  /** Dragging one side moves the other the same (the mirror's flexes). */
  mirror = false;
  private readonly panel: HTMLElement;
  private panelFor: string | null = null;
  private readonly rows = new Map<string, { input: HTMLInputElement; out: HTMLElement }>();
  private readonly m = new THREE.Matrix4();
  /** A press in the view off the controls: a click there (not a drag that orbits) lets go of the selected control. */
  private offPress: { x: number; y: number; id: number } | null = null;
  private readonly ray = new THREE.Raycaster();
  /** The name of the control under the pointer. */
  private readonly tip: HTMLElement;

  constructor(private view: { camera: THREE.Camera; controls: OrbitControls }, private el: HTMLElement, scene: THREE.Scene, container: HTMLElement, private hooks: FaceRigHooks) {
    this.root.name = "faceRig";
    this.root.visible = false;
    this.root.renderOrder = 1000;
    scene.add(this.root);
    this.panel = document.createElement("div");
    this.panel.className = "faceRigBox";
    this.panel.hidden = true;
    container.append(this.panel);
    this.tip = document.createElement("div");
    this.tip.className = "faceRigTip";
    this.tip.hidden = true;
    container.append(this.tip);
    // (in the capture phase on the view: a joystick taken is the rig's, not the orbit's, the selection's nor the click's)
    el.addEventListener("pointerdown", (e) => this.down(e), true);
    el.addEventListener("pointermove", (e) => this.move(e), true);
    el.addEventListener("pointerup", (e) => this.up(e), true);
    el.addEventListener("pointercancel", (e) => this.up(e), true);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.selected && this.active) this.select(null); });
  }

  get active(): boolean {
    return !!this.actor && !!this.layout;
  }

  /** The THREE objects of the rig (kept out of picking and outlines). */
  get objects(): THREE.Object3D[] {
    return [this.root];
  }

  /** Shows the rig of a character (null: none); `layout` from {@link analyzeFace}. */
  setActor(actor: Actor | null, layout: FaceLayout | null) {
    if (actor === this.actor && layout === this.layout) return;
    this.actor = layout ? actor : null;
    this.layout = actor ? layout : null;
    this.build();
  }

  private build() {
    for (const d of this.drawn) {
      d.group.removeFromParent();
      d.box.geometry.dispose();
      d.shape.geometry.dispose();
      d.shadow.geometry.dispose();
      d.dot.geometry.dispose();
    }
    this.drawn = [];
    this.root.visible = this.active;
    if (!this.layout) { this.select(null); return; }
    if (this.selected && !this.layout.controls.some((c) => c.id === this.selected)) this.selected = null;
    for (const control of this.layout.controls) {
      const color = COLORS[control.side];
      const [l, r, b, t] = control.reach;
      // where the control's middle can go (box units: 1 each way it goes, none the way it does not): a rectangle for one that goes both
      // ways, a track with end ticks for one that slides along one axis; a small cross where it rests
      const x0 = l ? -1 : 0, x1 = r ? 1 : 0, y0 = b ? -1 : 0, y1 = t ? 1 : 0;
      const tick = 0.18, rest = 0.12;
      const pts: number[] = [];
      if ((l || r) && (b || t)) pts.push(x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0);
      else if (l || r) pts.push(x0, 0, x1, 0, x0, -tick, x0, tick, x1, -tick, x1, tick);
      else pts.push(0, y0, 0, y1, -tick, y0, tick, y0, -tick, y1, tick, y1);
      pts.push(-rest, 0, rest, 0, 0, -rest, 0, rest);
      const boxGeo = new THREE.BufferGeometry();
      boxGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((v, i) => (i % 2 ? [v, 0] : [v])), 3));
      const box = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }));
      box.visible = false;
      // the control's outlines, over a dark band so they read on any skin
      const kind = control.id.replace(/[LR]$/, "");
      const morph = MORPHS[kind];
      const outlines = morph ? morph(0, 0) : SHAPES[kind] ?? [ellipse(0.55, 0.55)];
      const flat = (c: number, opacity: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      // (the lines as thick on every control: one with a wider sweep has larger units)
      const line = Math.min(...this.layout.controls.map((c) => c.size)) / control.size;
      const shadow = new THREE.Mesh(bands(outlines, 0.34 * line), flat(0x000000, 0.35));
      const shape = new THREE.Mesh(bands(outlines, 0.15 * line), flat(color, 0.95));
      const knob = new THREE.Group();
      knob.add(shadow, shape);
      // the joystick's place in its range (with the range, while the control is in hand)
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 14), flat(color, 1));
      dot.visible = false;
      box.renderOrder = 1000;
      shadow.renderOrder = 1001;
      shape.renderOrder = 1002;
      dot.renderOrder = 1003;
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.add(box, knob, dot);
      this.root.add(group);
      this.drawn.push({ control, group, box, knob, shape, shadow, dot, outlines, hit: outlines, u: 0, v: 0, morph });
    }
    this.update();
  }

  /** Puts the controls where the head is now and the joysticks where the flexes are. Call every frame while active. */
  update() {
    if (!this.actor || !this.layout) return;
    const get = (n: string) => this.hooks.get(n);
    for (const d of this.drawn) {
      const c = d.control;
      const m = this.actor.bindToScene(c.bone, this.m);
      if (!m) { d.group.visible = false; continue; }
      d.group.visible = true;
      // the control's frame in the scene: its axes scaled by its size, so its geometry is in box units
      const o = c.origin.clone().applyMatrix4(m);
      const ax = c.origin.clone().addScaledVector(c.x, c.size).applyMatrix4(m).sub(o);
      const ay = c.origin.clone().addScaledVector(c.y, c.size).applyMatrix4(m).sub(o);
      const az = c.origin.clone().addScaledVector(c.z, c.size).applyMatrix4(m).sub(o);
      d.group.matrix.makeBasis(ax, ay, az).setPosition(o);
      d.group.matrixWorldNeedsUpdate = true;
      const u = axisPosition(c.channels, "x", get), v = axisPosition(c.channels, "y", get);
      if (d.morph) {
        // (drawn as what it does, in place: the eyelid's shape follows the lid)
        if (u !== d.u || v !== d.v) {
          d.outlines = d.morph(u, v);
          d.shape.geometry.dispose();
          d.shadow.geometry.dispose();
          d.shape.geometry = bands(d.outlines, 0.15);
          d.shadow.geometry = bands(d.outlines, 0.34);
        }
      } else d.knob.position.set(u, v, 0);
      d.u = u;
      d.v = v;
      const chosen = this.drag?.d === d || this.selected === c.id;
      const hover = this.hovered === c.id;
      (d.shape.material as THREE.MeshBasicMaterial).color.setHex(chosen ? SELECTED : hover ? HOVER : COLORS[c.side]);
      (d.shadow.material as THREE.MeshBasicMaterial).opacity = chosen || hover ? 0.6 : 0.35;
      // (the range only for the control in hand: the face stays readable)
      d.box.visible = d.dot.visible = chosen || hover;
      d.dot.position.set(u, v, 0);
      (d.dot.material as THREE.MeshBasicMaterial).color.setHex(chosen ? SELECTED : HOVER);
    }
    this.refreshPanel();
  }

  /** The joystick under a point of the view (client coordinates), if any. */
  pick(clientX: number, clientY: number): Drawn | null {
    if (!this.active) return null;
    const rect = this.el.getBoundingClientRect();
    // on a control's outline, or inside it (the smallest one a point is inside wins)
    let best: Drawn | null = null, bestScore = Infinity;
    const p = new THREE.Vector3();
    for (const d of this.drawn) {
      if (!d.group.visible) continue;
      d.knob.updateMatrixWorld(true);
      let behind = false;
      const polys = d.hit.map((o) => o.map(([x, y]) => {
        p.set(x, y, 0).applyMatrix4(d.knob.matrixWorld).project(this.view.camera);
        if (p.z > 1) behind = true;
        return [rect.left + ((p.x + 1) / 2) * rect.width, rect.top + ((1 - p.y) / 2) * rect.height] as [number, number];
      }));
      if (behind) continue;
      for (const poly of polys) {
        const edge = edgeDistance(clientX, clientY, poly);
        const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
        const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        const score = edge <= PICK_RADIUS ? edge : inside(clientX, clientY, poly) ? PICK_RADIUS + Math.sqrt(area) : Infinity;
        if (score < bestScore) { bestScore = score; best = d; }
      }
    }
    return best;
  }

  /** Where a pointer meets a control's plane, in its box units. */
  private local(d: Drawn, plane: THREE.Plane, clientX: number, clientY: number): THREE.Vector2 | null {
    const rect = this.el.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.view.camera);
    const hit = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    d.group.updateMatrixWorld(true);
    const inv = d.group.matrixWorld.clone().invert();
    hit.applyMatrix4(inv);
    return new THREE.Vector2(hit.x, hit.y);
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || !this.active || e.altKey) return;
    const d = this.pick(e.clientX, e.clientY);
    if (!d) { this.offPress = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
    this.offPress = null;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.select(d.control.id);
    d.group.updateMatrixWorld(true);
    const normal = new THREE.Vector3().setFromMatrixColumn(d.group.matrixWorld, 2).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3().setFromMatrixPosition(d.group.matrixWorld));
    const grab = this.local(d, plane, e.clientX, e.clientY);
    if (!grab) return;
    this.drag = { d, plane, grab, start: new THREE.Vector2(d.u, d.v), pointer: e.pointerId };
    this.view.controls.enabled = false;
    this.el.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (!this.drag) {
      if (e.buttons !== 0 || !this.active) return;
      const id = this.pick(e.clientX, e.clientY)?.control.id ?? null;
      if (id !== this.hovered) { this.hovered = id; this.el.style.cursor = id ? "grab" : ""; this.update(); }
      this.showTip(id, e.clientX, e.clientY);
      return;
    }
    e.stopImmediatePropagation();
    this.tip.hidden = true;
    const { d, plane, grab, start } = this.drag;
    const at = this.local(d, plane, e.clientX, e.clientY);
    if (!at) return;
    const [l, r, b, t] = d.control.reach;
    // Shift: straight along the axis it has moved most along
    let du = at.x - grab.x, dv = at.y - grab.y;
    if (e.shiftKey) { if (Math.abs(du) > Math.abs(dv)) dv = 0; else du = 0; }
    const u = Math.max(l ? -1 : 0, Math.min(r ? 1 : 0, start.x + du));
    const v = Math.max(b ? -1 : 0, Math.min(t ? 1 : 0, start.y + dv));
    this.write(d.control, u, v);
  }

  private up(e: PointerEvent) {
    const off = this.offPress;
    this.offPress = null;
    if (off && off.id === e.pointerId && Math.hypot(e.clientX - off.x, e.clientY - off.y) <= 4 && this.selected) this.select(null);
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    e.stopImmediatePropagation();
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.view.controls.enabled = true;
    this.update();
  }

  /** The name of the control under the pointer, beside it. */
  private showTip(id: string | null, x: number, y: number) {
    const c = id ? this.layout?.controls.find((k) => k.id === id) : null;
    this.tip.hidden = !c || !this.active;
    if (!c) return;
    this.tip.textContent = c.label;
    const box = this.tip.parentElement!.getBoundingClientRect();
    this.tip.style.left = `${x - box.left + 14}px`;
    this.tip.style.top = `${y - box.top + 14}px`;
  }

  /** Sets a control's flexes for a joystick position (and the mirror's, when mirroring). */
  private write(c: FaceControl, u: number, v: number) {
    const values: [string, number][] = [];
    for (const [ch, value] of [...axisValues(c.channels, "x", u), ...axisValues(c.channels, "y", v)]) {
      values.push([ch.name, value]);
      if (this.mirror && ch.mirror) values.push([ch.mirror, value]);
    }
    this.hooks.set(values);
    this.update();
  }

  /** Selects a control (null: none): its channel box opens. */
  select(id: string | null) {
    this.selected = id;
    this.tip.hidden = true;
    this.update();
  }

  /** Where to look at the face from straight on, in the scene: the point to look at, the way to look from, and how far to see round it. */
  front(): { target: THREE.Vector3; way: THREE.Vector3; size: number } | null {
    if (!this.actor || !this.layout) return null;
    const m = this.actor.bindToScene(this.layout.controls[0].bone, this.m);
    if (!m) return null;
    const { middle, out, span } = this.layout;
    const target = middle.clone().applyMatrix4(m);
    const way = middle.clone().add(out).applyMatrix4(m).sub(target);
    const scale = way.length();
    return { target, way: way.normalize(), size: (span * scale) / 2 };
  }

  /** Every flex of the rig back to 0. */
  reset() {
    if (!this.layout) return;
    this.hooks.set(this.layout.controls.flatMap((c) => c.channels.map((ch) => [ch.name, 0] as [string, number])));
    this.update();
  }

  private refreshPanel() {
    const control = this.active ? this.layout!.controls.find((c) => c.id === this.selected) ?? null : null;
    this.panel.hidden = !control;
    if (!control) { this.panelFor = null; return; }
    if (this.panelFor !== control.id) {
      this.panelFor = control.id;
      this.rows.clear();
      this.panel.innerHTML = "";
      const head = document.createElement("div");
      head.className = "faceRigHead";
      head.textContent = control.label;
      const close = document.createElement("button");
      close.className = "faceRigClose";
      close.textContent = "✕";
      close.title = "Close (Esc)";
      close.onclick = () => this.select(null);
      head.append(close);
      this.panel.append(head);
      const group = (title: string, chans: FaceChannel[]) => {
        if (!chans.length) return;
        const h = document.createElement("div");
        h.className = "faceRigGroup";
        h.textContent = title;
        this.panel.append(h);
        for (const ch of chans) {
          const row = document.createElement("label");
          row.className = "faceRigRow";
          const name = document.createElement("span");
          name.textContent = ch.name.replace(/^(left|right)_/, "");
          name.title = ch.name;
          const input = document.createElement("input");
          input.type = "range";
          input.min = String(ch.min);
          input.max = String(ch.max);
          input.step = "0.01";
          const out = document.createElement("span");
          out.className = "faceRigValue";
          input.oninput = () => {
            const v = Number(input.value);
            this.hooks.set(this.mirror && ch.mirror ? [[ch.name, v], [ch.mirror, v]] : [[ch.name, v]]);
            this.update();
          };
          input.ondblclick = () => { input.value = "0"; input.oninput?.(new Event("input")); };
          row.append(name, input, out);
          this.panel.append(row);
          this.rows.set(ch.name, { input, out });
        }
      };
      group("Joystick", control.channels.filter((c) => c.axis !== "extra"));
      group("More", control.channels.filter((c) => c.axis === "extra"));
    }
    for (const [name, row] of this.rows) {
      const v = this.hooks.get(name);
      if (document.activeElement !== row.input) row.input.value = String(v);
      row.out.textContent = v.toFixed(2);
    }
  }
}
