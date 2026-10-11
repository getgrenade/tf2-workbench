import { fn, register, type Collection } from "./collection";
import { noise4 } from "./noise";

/**
 * The emitters: how many particles a system makes and when. An emitter says how many to create this step (`emit`); the collection makes them
 * and runs the initializers. An instantaneous burst is born at its start time (`creationTime`), a continuous stream at the time of the step.
 */

/** How the number of particles of an emitter scales with the control points and the parent's particles. */
function scaleByParent(c: Collection, enabled: boolean): number {
  return enabled && c.parent ? c.parent.n : 1;
}

register("emit_continuously", (a) => {
  const start = a.num("emission_start_time"), duration = a.num("emission_duration"), rate = a.num("emission_rate");
  const perCp = a.num("scale emission to used control points"), perParent = a.bool("use parent particles for emission scaling");
  let accum = 0, stopped = false;
  return fn(a, {
    emit(c, strength) {
      if (stopped || rate === 0) return 0;
      const end = duration > 0 ? start + duration : Infinity;
      const from = Math.max(c.time - c.dt, start), to = Math.min(c.time, end);
      if (to <= from) return 0;
      let r = rate * strength * scaleByParent(c, perParent);
      if (perCp !== 0) r *= perCp * (c.highestCP + 1);
      accum += r * (to - from);
      const n = Math.floor(accum + 1e-6);
      accum -= n;
      return n;
    },
    start() { stopped = false; },
    stop() { stopped = true; },
    restart() { accum = 0; stopped = false; },
    mayCreateMore: () => !stopped,
  });
});

register("emit_instantaneously", (a) => {
  const start = a.num("emission_start_time"), max = a.int("num_to_emit"), min = a.int("num_to_emit_minimum", -1);
  const perFrame = a.int("maximum emission per frame", -1);
  const scaleCp = a.int("emission count scale control point", -1), scaleField = a.int("emission count scale control point field");
  let emitted = 0, total = -1, stopped = false;
  return fn(a, {
    emit(c, strength) {
      if (stopped || c.time < start) return 0;
      if (total < 0) {
        total = min >= 0 && min < max ? c.randInt(min, max) : max;
        if (scaleCp >= 0) total = Math.round(total * c.cps[scaleCp].pos[Math.max(0, Math.min(2, scaleField))]);
        total = Math.max(0, Math.round(total * strength));
      }
      let n = total - emitted;
      if (n <= 0) return 0;
      if (perFrame > 0) n = Math.min(n, perFrame);
      emitted += n;
      return n;
    },
    start() { stopped = false; },
    stop() { stopped = true; },
    creationTime: () => start,
    restart() { emitted = 0; total = -1; stopped = false; },
    mayCreateMore: () => !stopped && (total < 0 || emitted < total),
  });
});

register("emit noise", (a) => {
  const start = a.num("emission_start_time"), duration = a.num("emission_duration");
  const timeScale = a.num("time noise coordinate scale"), offset = a.num("time coordinate offset"), worldScale = a.num("world time noise coordinate scale");
  const min = a.num("emission minimum"), max = a.num("emission maximum");
  const abs = a.bool("absolute value"), invert = a.bool("invert absolute value");
  const perCp = a.num("scale emission to used control points");
  let accum = 0, stopped = false;
  return fn(a, {
    emit(c, strength) {
      if (stopped) return 0;
      const end = duration > 0 ? start + duration : Infinity;
      const from = Math.max(c.time - c.dt, start), to = Math.min(c.time, end);
      if (to <= from) return 0;
      let v = noise4(0, 0, 0, c.time * timeScale + offset + (worldScale ? c.time * worldScale : 0));
      if (abs) v = Math.abs(v);
      if (invert) v = 1 - Math.abs(v);
      const unit = abs || invert ? v : v * 0.5 + 0.5;
      let r = (min + (max - min) * unit) * strength;
      if (perCp !== 0) r *= perCp * (c.highestCP + 1);
      accum += r * (to - from);
      const n = Math.floor(accum + 1e-6);
      accum -= n;
      return n;
    },
    start() { stopped = false; },
    stop() { stopped = true; },
    restart() { accum = 0; stopped = false; },
    mayCreateMore: () => !stopped,
  });
});
