/**
 * The face a choreography scene makes at a moment: its flex animation tracks and its expressions, then the mouth shapes of what is being
 * said. Ported from the Source SDK 2013: `CFlexAnimationTrack::GetFracIntensity` and `CCurveData::GetIntensity` (game/shared/
 * choreoevent.cpp), `Interpolator_CurveInterpolate` (public/interpolatortypes.cpp) and the splines it calls (mathlib), and the way
 * `C_BaseFlex` applies them (game/client/c_baseflex.cpp): a flex animation sets a controller (blended by the event's intensity), an
 * expression blends it toward the setting's weight by its influence, and a phoneme adds its mouth shape on top.
 *
 * Values are controllers' real values by lower-case name, as {@link FlexGlobals}.
 */
import type { FlexGlobals } from "./flex";

/** [time, value 0..1, curve type]; times are seconds from the start of the event (of the scene for its ramp). */
export type CurveSample = [number, number, number];

export interface SceneTrack {
  controller: string;
  combo: boolean;
  min: number;
  max: number;
  samples: CurveSample[];
  balance: CurveSample[];
}

export interface SceneEvent {
  kind: string;
  name: string;
  start: number;
  /** -1: no end time. */
  end: number;
  params: string;
  params2: string;
  ramp: CurveSample[];
  tracks: SceneTrack[];
}

export interface SceneData {
  path: string;
  events: SceneEvent[];
  ramp: CurveSample[];
  /** Expression file (lower case, forward slashes) -> setting (lower case) -> [controller, weight, influence]. */
  expressions: Record<string, Record<string, [string, number, number][]>>;
  /** The sounds the speak events play: name (lower case) -> the waves (several: the game picks one at random). */
  sounds: Record<string, { name: string; waves: string[] }>;
}

/** A class's mouth shapes: phoneme code -> [controller, weight] for the normal, weak and strong phoneme classes. */
export interface PhonemeClasses {
  normal?: Record<string, [string, number][]>;
  weak?: Record<string, [string, number][]>;
  strong?: Record<string, [string, number][]>;
}

/** A line's lip sync: phonemes [code, start, end] and emphasis [time, 0..1], seconds from the start of the line. */
export interface LipSync {
  phonemes: [number, number, number][];
  emphasis: [number, number][];
}

// interpolatortypes.h
const DEFAULT = 0, CATMULL_ROM_NORMALIZEX = 1, EASE_IN = 2, EASE_OUT = 3, EASE_INOUT = 4, BSPLINE = 5, LINEAR = 6, KB = 7, KB_EARLY = 8, KB_LATE = 9,
  SIMPLE_CUBIC = 10, CATMULL_ROM = 11, CATMULL_ROM_NORMALIZE = 12, CATMULL_ROM_TANGENT = 13, EXPONENTIAL_DECAY = 14, HOLD = 15;
/** An event's default curve (`CChoreoEvent::m_nDefaultCurveType`): Catmull-Rom both ways. */
const EVENT_DEFAULT_CURVE = (CATMULL_ROM_NORMALIZEX << 8) | CATMULL_ROM_NORMALIZEX;

type P = [number, number];
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const lerp = (a: P, b: P, f: number): P => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

function catmullRom(p1: P, p2: P, p3: P, p4: P, t: number): P {
  const tSqr = t * t * 0.5, tSqrSqr = t * tSqr, th = t * 0.5;
  const out: P = [0, 0];
  for (let i = 0; i < 2; i++) {
    out[i] = tSqrSqr * (-p1[i] + 3 * p2[i] - 3 * p3[i] + p4[i]) + tSqr * (2 * p1[i] - 5 * p2[i] + 4 * p3[i] - p4[i]) + th * (-p1[i] + p3[i]) + p2[i];
  }
  return out;
}

/** `Spline_Normalize`: the outer points moved so that their spacing in x matches the middle segment's. */
function normalizeX(p1: P, p2: P, p3: P, p4: P): [P, P] {
  const dt = p3[0] - p2[0];
  let a = p1, b = p4;
  if (dt !== 0) {
    if (p1[0] !== p2[0]) a = lerp(p2, p1, dt / (p2[0] - p1[0]));
    if (p4[0] !== p3[0]) b = lerp(p3, p4, dt / (p4[0] - p3[0]));
  }
  return [a, b];
}

function kochanekBartels(tension: number, bias: number, continuity: number, p1: P, p2: P, p3: P, p4: P, t: number): P {
  const ffa = (1 - tension) * (1 + continuity) * (1 + bias), ffb = (1 - tension) * (1 - continuity) * (1 - bias);
  const ffc = (1 - tension) * (1 - continuity) * (1 + bias), ffd = (1 - tension) * (1 + continuity) * (1 - bias);
  const tSqr = t * t * 0.5, tSqrSqr = t * tSqr, th = t * 0.5;
  const out: P = [0, 0];
  for (let i = 0; i < 2; i++) {
    out[i] =
      tSqrSqr * (-ffa * p1[i] + (4 + ffa - ffb - ffc) * p2[i] + (-4 + ffb + ffc - ffd) * p3[i] + ffd * p4[i]) +
      tSqr * (2 * ffa * p1[i] + (-6 - 2 * ffa + 2 * ffb + ffc) * p2[i] + (6 - 2 * ffb - ffc + ffd) * p3[i] - ffd * p4[i]) +
      th * (-ffa * p1[i] + (ffa - ffb) * p2[i] + ffb * p3[i]) +
      p2[i];
  }
  return out;
}

function interpolate(type: number, pre: P, start: P, end: P, next: P, f: number): P {
  switch (type) {
    case CATMULL_ROM: case CATMULL_ROM_TANGENT: return catmullRom(pre, start, end, next, f);
    case CATMULL_ROM_NORMALIZE: {
      const d = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const unit = (a: P, b: P): P => { const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [b[0] + ((a[0] - b[0]) / l) * d, b[1] + ((a[1] - b[1]) / l) * d]; };
      return catmullRom(unit(pre, start), start, end, unit(next, end), f);
    }
    case EASE_IN: return lerp(start, end, Math.sin(Math.PI * f * 0.5));
    case EASE_OUT: return lerp(start, end, 1 - Math.sin(Math.PI * f * 0.5 + 0.5 * Math.PI));
    case EASE_INOUT: return lerp(start, end, f * f * (3 - 2 * f));
    case LINEAR: return lerp(start, end, f);
    case KB: case KB_EARLY: case KB_LATE: {
      const [a, b] = normalizeX(pre, start, end, next);
      return kochanekBartels(0.77, type === KB_EARLY ? -1 : type === KB_LATE ? 1 : 0, 0.77, a, start, end, b, f);
    }
    case SIMPLE_CUBIC: {
      const t2 = f * f, t3 = t2 * f;
      return [start[0] + (end[0] - start[0]) * (3 * t2 - 2 * t3), start[1] + (end[1] - start[1]) * (3 * t2 - 2 * t3)];
    }
    case BSPLINE: {
      const out: P = [0, 0];
      const t2 = f * f, t3 = t2 * f;
      for (let i = 0; i < 2; i++) out[i] = ((-t3 + 3 * t2 - 3 * f + 1) * pre[i] + (3 * t3 - 6 * t2 + 4) * start[i] + (-3 * t3 + 3 * t2 + 3 * f + 1) * end[i] + t3 * next[i]) / 6;
      return out;
    }
    case EXPONENTIAL_DECAY: {
      const dt = end[0] - start[0];
      if (dt <= 0) return [start[0], start[1]];
      const val = 1 - Math.exp((Math.log(0.001) / dt) * f * dt);
      return [start[0], start[1] + val * (end[1] - start[1])];
    }
    case HOLD: return [start[0], start[1]];
    case DEFAULT: case CATMULL_ROM_NORMALIZEX: default: {
      const [a, b] = normalizeX(pre, start, end, next);
      return catmullRom(a, start, end, b, f);
    }
  }
}

/**
 * A curve's value at `time` (0..duration): the samples, bounded by `zeroLeft` at 0 and `zeroRight` at the end (edge samples of the
 * default curve), interpolated as the samples' curve types say (0: `defaultCurve`). `clampEdges` puts the outer points of the edge
 * segments on their neighbours' x, as an event ramp does.
 */
export function curveValue(samples: CurveSample[], time: number, duration: number, zeroLeft: number, zeroRight: number, defaultCurve = 0, clampEdges = false): number {
  const n = samples.length;
  if (n < 1) return zeroLeft;
  const bounded = (i: number): CurveSample => (i < 0 ? [0, zeroLeft, 0] : i >= n ? [duration, zeroRight, 0] : samples[i]);
  // the segment that spans the time (the samples are in order)
  let i = -1;
  while (i < n - 1 && time > bounded(i + 1)[0]) i++;
  if (i < n - 1 && time === bounded(i + 1)[0]) i++;
  const s = bounded(i), e = bounded(i + 1), preS = bounded(Math.max(-1, i - 1)), nextS = bounded(Math.min(i + 2, n));
  const start: P = [s[0], s[1]], end: P = [e[0], e[1]];
  const pre: P = [clampEdges && i - 1 < 0 ? s[0] : preS[0], preS[1]];
  const next: P = [clampEdges && i + 2 >= n ? e[0] : nextS[0], nextS[1]];
  const dt = end[0] - start[0];
  const f = clamp(dt > 0 ? (time - start[0]) / dt : 0, 0, 1);
  const curveOf = (c: number) => (c === 0 ? defaultCurve : c);
  const early = curveOf(s[2]) & 0xff, later = (curveOf(e[2]) >> 8) & 0xff;
  let y: number;
  if (early === HOLD) y = start[1];
  else if (later === HOLD) y = end[1];
  else if (early === later) y = interpolate(later, pre, start, end, next, f)[1];
  else {
    const a = interpolate(early, pre, start, end, next, f), b = interpolate(later, pre, start, end, next, f);
    y = a[1] + (b[1] - a[1]) * f;
  }
  return clamp(y, 0, 1);
}

const duration = (e: SceneEvent) => (e.end >= 0 ? e.end - e.start : 0);

/** An event's intensity at a scene time: its ramp (none: full) times the scene's. */
export function eventIntensity(scene: SceneData, e: SceneEvent, time: number): number {
  const local = e.ramp.length ? curveValue(e.ramp, time - e.start, duration(e), 0, 0, EVENT_DEFAULT_CURVE, true) : 1;
  const end = Math.max(0, ...scene.events.map((x) => x.end));
  const global = scene.ramp.length ? curveValue(scene.ramp, time, end, 0, 0, EVENT_DEFAULT_CURVE, true) : 1;
  return local * global;
}

/** A track's real value at a time in its event (`GetIntensity`), for side 0 (`right_`) or 1 (`left_`) of a combo track. */
export function trackValue(t: SceneTrack, elapsed: number, length: number, side = 0): number {
  const zero = t.min !== t.max ? (0 - t.min) / (t.max - t.min) : 0;
  let v = curveValue(t.samples, elapsed, length, zero, zero);
  if (t.min !== t.max) v = v * (t.max - t.min) + t.min;
  if (t.combo) {
    const balance = curveValue(t.balance, elapsed, length, 0.5, 0.5);
    if (side === 0 && balance > 0.5) v *= (1 - balance) / 0.5;
    else if (side === 1 && balance < 0.5) v *= balance / 0.5;
  }
  return v;
}

/**
 * The face of `scene` at scene time `time`, over `base` (the character's own controller values): the flex animations set their
 * controllers, then the expressions blend theirs. `controllers` are the model's controller names (lower case), for the stereo tracks'
 * `left_` and `right_` halves.
 */
export function sceneFace(scene: SceneData, time: number, base: FlexGlobals, controllers: ReadonlySet<string>): FlexGlobals {
  const out = new Map(base);
  const live = scene.events.filter((e) => e.end >= 0 && time >= e.start && time <= e.end);
  for (const e of live) {
    if (e.kind !== "flexanimation" || !e.tracks.length) continue;
    const w = eventIntensity(scene, e, time);
    const elapsed = time - e.start, length = duration(e);
    for (const t of e.tracks) {
      const name = t.controller.toLowerCase();
      const sides: [string, number][] = t.combo ? [[`right_${name}`, 0], [`left_${name}`, 1]] : [[name, 0]];
      for (const [key, side] of sides) {
        if (t.combo && !controllers.has(key)) continue;
        const orig = out.get(key) ?? 0;
        out.set(key, orig * (1 - w) + trackValue(t, elapsed, length, side) * w);
      }
    }
  }
  for (const e of live) {
    if (e.kind !== "expression") continue;
    const setting = scene.expressions[e.params.replace(/\\/g, "/").toLowerCase()]?.[e.params2.toLowerCase()];
    if (!setting) continue;
    const scale = eventIntensity(scene, e, time);
    for (const [controller, weight, influence] of setting) {
      const key = controller.toLowerCase();
      const s = clamp(scale * influence, 0, 1);
      out.set(key, (out.get(key) ?? 0) * (1 - s) + weight * s);
    }
  }
  return out;
}

const STRONG_CROSSFADE_START = 0.6, WEAK_CROSSFADE_START = 0.4;

/** How much of each phoneme class an emphasis calls for (`ComputeBlendedSetting`). */
function classAmounts(classes: PhonemeClasses, code: string, emphasis: number): [Record<string, [string, number][]>, number][] {
  if (!classes.normal?.[code]) return [];
  const normal = classes.normal, weak = classes.weak?.[code] ? classes.weak : null, strong = classes.strong?.[code] ? classes.strong : null;
  if (emphasis > STRONG_CROSSFADE_START) {
    if (strong) {
      const frac = (1 - emphasis) / (1 - STRONG_CROSSFADE_START);
      return [[normal, frac * 2 * STRONG_CROSSFADE_START], [strong, 1 - frac]];
    }
    return [[normal, 2 * Math.min(emphasis, STRONG_CROSSFADE_START)]];
  }
  if (emphasis < WEAK_CROSSFADE_START) {
    if (weak) {
      const frac = (WEAK_CROSSFADE_START - emphasis) / WEAK_CROSSFADE_START;
      return [[normal, (1 - frac) * 2 * WEAK_CROSSFADE_START], [weak, frac]];
    }
    return [[normal, 2 * Math.max(emphasis, WEAK_CROSSFADE_START)]];
  }
  return [[normal, 2 * emphasis]];
}

/** Adds a phoneme's mouth shape, `scale` of it (`AddViseme`). */
export function addViseme(out: FlexGlobals, classes: PhonemeClasses, code: number, scale: number, emphasis = 0.5) {
  for (const [table, amount] of classAmounts(classes, String(code), emphasis)) {
    for (const [controller, weight] of table[String(code)] ?? []) {
      const key = controller.toLowerCase();
      out.set(key, (out.get(key) ?? 0) + amount * scale * weight);
    }
  }
}

/** The emphasis of a line at a time (`CSentence::GetIntensity`: 0.5 when it has none). */
function emphasisAt(lip: LipSync, t: number, length: number): number {
  if (!lip.emphasis.length) return 0.5;
  return curveValue(lip.emphasis.map(([time, v]) => [time, v, (CATMULL_ROM << 8) | CATMULL_ROM] as CurveSample), t, length, 0.5, 0.5);
}

/** The phoneme filter (`phonemefilter`): each phoneme is box-filtered over this long. */
const PHONEME_FILTER = 0.08;

/** Adds the mouth shapes of a line's phonemes at `t` seconds into it (`AddVisemesForSentence`, crossfading as at the highest detail). */
export function addLipSync(out: FlexGlobals, classes: PhonemeClasses, lip: LipSync, t: number, length: number) {
  const emphasis = emphasisAt(lip, t, length);
  const list = lip.phonemes;
  for (let k = 0; k < list.length; k++) {
    const [code, start, end] = list[k];
    let dt = PHONEME_FILTER;
    if (t > start && t < end) {
      const next = list[k + 1];
      if (next) dt = next[1] === end ? Math.max(dt, Math.min(next[2] - t, end - start)) : Math.max(dt, Math.min(next[1] - t, end - start));
      else dt = Math.max(dt, end - start);
    }
    let t1 = (start - t) / dt, t2 = (end - t) / dt;
    if (t1 < 1 && t2 > 0) {
      t2 = Math.min(t2, 1);
      t1 = Math.max(t1, 0);
      addViseme(out, classes, code, t2 - t1, emphasis);
    }
  }
}
