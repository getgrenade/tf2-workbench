import { fn, register, type Collection } from "./collection";
import type { Attrs, Vec3 } from "./attrs";
import { clamp, lerp, normalize } from "./util";

/**
 * The functions that work along the path between two control points (a rope, a beam, a bolt): the path is a curve through the start point,
 * a middle point (a fraction of the way, pushed sideways by the bulge) and the end point.
 */
interface Path { start: number; end: number; bulgeControl: number; bulge: number; mid: number }

function pathOf(a: Attrs): Path {
  return {
    start: a.int("start control point number"), end: a.int("end control point number"),
    bulgeControl: a.int("bulge control 0=random 1=orientation of start pnt 2=orientation of end point"), bulge: a.num("bulge"),
    mid: a.num("mid point position", 0.5),
  };
}

const scratch = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as Vec3[];

/** The start, middle and end of the path now (CalculatePathValues). The middle is bulged sideways: along the orientation of one end, or at random. */
export function pathValues(c: Collection, p: Path, out: Vec3[] = scratch, randomBulge?: Vec3): Vec3[] {
  const s = c.cps[p.start].pos, e = c.cps[p.end].pos;
  for (let k = 0; k < 3; k++) { out[0][k] = s[k]; out[2][k] = e[k]; out[1][k] = (1 - p.mid) * s[k] + p.mid * e[k]; }
  if (p.bulge !== 0) {
    const length = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
    let dir: Vec3;
    if (p.bulgeControl === 1) dir = c.cps[p.start].right;
    else if (p.bulgeControl === 2) dir = c.cps[p.end].right;
    else dir = randomBulge ?? [0, 0, 1];
    for (let k = 0; k < 3; k++) out[1][k] += dir[k] * p.bulge * length;
  }
  return out;
}

/** A point of the quadratic curve through the three points, at t in 0..1. */
export function onPath(points: Vec3[], t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const u = 1 - t;
  for (let k = 0; k < 3; k++) out[k] = u * u * points[0][k] + 2 * u * t * points[1][k] + t * t * points[2][k];
  return out;
}

const point: Vec3 = [0, 0, 0], offset: Vec3 = [0, 0, 0];

register("Position Along Path Random", (a) => {
  const path = pathOf(a), maxDistance = a.num("maximum distance");
  return fn(a, {
    initialize(c, first, n) {
      const bulgeDir = c.randInUnitSphere([0, 0, 0] as Vec3) >= 0 ? ([c.rand(-1, 1), c.rand(-1, 1), c.rand(-1, 1)] as Vec3) : ([0, 0, 1] as Vec3);
      normalize(bulgeDir);
      const points = pathValues(c, path, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bulgeDir);
      for (let i = first; i < first + n; i++) {
        const t = c.rand();
        onPath(points, t, point);
        c.randInUnitSphere(offset);
        for (let k = 0; k < 3; k++) { c.xyz[i * 3 + k] = point[k] + offset[k] * maxDistance; c.prev[i * 3 + k] = c.xyz[i * 3 + k]; }
      }
    },
  });
});

register("Position Along Path Sequential", (a) => {
  const path = pathOf(a), maxDistance = a.num("maximum distance"), count = Math.max(2, a.int("particles to map from start to end", 20));
  const loop = a.bool("restart behavior (0 = bounce, 1 = loop )"), sequentialPairs = a.bool("Use sequential CP pairs between start and end point"), save = a.bool("Save Offset");
  let counter = 0;
  return fn(a, {
    initialize(c, first, n) {
      const bulgeDir: Vec3 = [c.rand(-1, 1), c.rand(-1, 1), c.rand(-1, 1)];
      normalize(bulgeDir);
      for (let i = first; i < first + n; i++) {
        const k = counter++;
        let step = k % (loop ? count : count * 2 - 2 || 1);
        if (!loop && step >= count) step = count * 2 - 2 - step;
        const t = step / (count - 1);
        let p = path;
        if (sequentialPairs) {
          // one path per pair of neighbouring control points between the start and the end
          const pairs = Math.max(1, path.end - path.start);
          const pair = Math.min(pairs - 1, Math.floor(t * pairs));
          p = { ...path, start: path.start + pair, end: path.start + pair + 1 };
        }
        const points = pathValues(c, p, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bulgeDir);
        const local = sequentialPairs ? t * Math.max(1, path.end - path.start) - Math.floor(t * Math.max(1, path.end - path.start)) : t;
        onPath(points, local, point);
        c.randInUnitSphere(offset);
        for (let m = 0; m < 3; m++) { c.xyz[i * 3 + m] = point[m] + offset[m] * maxDistance; c.prev[i * 3 + m] = c.xyz[i * 3 + m]; }
        if (save) { c.traceHit[i] = t; for (let m = 0; m < 3; m++) c.hitRel[i * 3 + m] = offset[m] * maxDistance; }
      }
    },
    restart() { counter = 0; },
  });
});

register("Position In CP Hierarchy", (a) => {
  const path = pathOf(a), maxDistance = a.num("maximum distance"), growth = a.num("growth time"), highest = a.bool("use highest supplied end point");
  const biasVec = a.vec("distance_bias", [1, 1, 1]);
  return fn(a, {
    initialize(c, first, n) {
      const end = highest ? c.highestCP : path.end;
      const reach = growth > 0 ? Math.min(1, c.time / growth) : 1;
      for (let i = first; i < first + n; i++) {
        // somewhere along the chain of control points from the start to the end, within `maximum distance`
        const t = c.rand() * reach;
        const span = Math.max(1, end - path.start);
        const idx = Math.min(span - 1, Math.floor(t * span));
        const a0 = c.cps[path.start + idx].pos, b0 = c.cps[Math.min(63, path.start + idx + 1)].pos;
        const f = t * span - idx;
        c.randInUnitSphere(offset);
        for (let k = 0; k < 3; k++) { c.xyz[i * 3 + k] = lerp(a0[k], b0[k], f) + offset[k] * maxDistance * biasVec[k]; c.prev[i * 3 + k] = c.xyz[i * 3 + k]; }
      }
    },
  });
});

register("Random position within a curved cylinder", (a) => {
  const first0 = a.int("starting control point for cylinder"), last = a.int("maximum end control point for cylinder", 30);
  const vMin = a.num("min scale factor for mapping cp velocity to particle velocity", 1), vMax = a.num("max scale factor for mapping cp velocity to particle velocity", 1);
  const pMin = a.num("min scale factor for particle velocity along path"), pMax = a.num("max scale factor for particle velocity along path");
  return fn(a, {
    initialize(c, first, n) {
      const top = Math.min(last, c.highestCP);
      for (let i = first; i < first + n; i++) {
        const seg = c.randInt(first0, Math.max(first0, top - 1));
        const a0 = c.cps[seg], b0 = c.cps[Math.min(63, seg + 1)];
        const t = c.rand();
        for (let k = 0; k < 3; k++) {
          const p = lerp(a0.pos[k], b0.pos[k], t);
          c.xyz[i * 3 + k] = p; c.prev[i * 3 + k] = p;
        }
        const s = c.rand(vMin, vMax);
        const along = c.rand(pMin, pMax);
        for (let k = 0; k < 3; k++) {
          const v = a0.velocity[k] * s + (b0.pos[k] - a0.pos[k]) * along;
          c.prev[i * 3 + k] -= v * c.dt;
        }
      }
    },
  });
});

/**
 * Particles that fly from where they are made to the end control point at their own speed (units per second) and end there: a bullet tracer.
 * The speed is a distance per second, the lifetime is what the way takes, so the sprite trail reaches the end point as it dies.
 */
register("move particles between 2 control points", (a) => {
  const endCp = a.int("end control point"), min = a.num("minimum speed"), max = a.num("maximum speed"), spread = a.num("end spread"), startOffset = a.num("start offset"), endOffset = a.num("end offset");
  return fn(a, {
    initialize(c, first, n) {
      const end = c.cps[endCp].pos;
      for (let i = first; i < first + n; i++) {
        const target: Vec3 = [end[0] - c.xyz[i * 3], end[1] - c.xyz[i * 3 + 1], end[2] - c.xyz[i * 3 + 2]];
        if (spread > 0) { const r: Vec3 = [0, 0, 0]; c.randInUnitSphere(r); for (let k = 0; k < 3; k++) target[k] += r[k] * spread; }
        const length = Math.hypot(target[0], target[1], target[2]);
        if (length < 1e-6) { c.life[i] = 0; continue; }
        const dir: Vec3 = [target[0] / length, target[1] / length, target[2] / length];
        const speed = Math.max(1e-3, c.rand(min, max));
        for (let k = 0; k < 3; k++) {
          c.xyz[i * 3 + k] += dir[k] * startOffset;
          c.launch[i * 3 + k] = dir[k] * speed;
        }
        c.life[i] = Math.max(0, (length - startOffset - endOffset) / speed);
      }
    },
  });
});

register("Movement Lock to Saved Position Along Path", (a) => {
  const path = pathOf(a), sequentialPairs = a.bool("Use sequential CP pairs between start and end point");
  return fn(a, {
    operate(c, strength) {
      const pairs = Math.max(1, path.end - path.start);
      for (let i = 0; i < c.n; i++) {
        const t = c.traceHit[i];
        let p = path, local = t;
        if (sequentialPairs) {
          const pair = Math.min(pairs - 1, Math.floor(t * pairs));
          p = { ...path, start: path.start + pair, end: path.start + pair + 1 };
          local = t * pairs - pair;
        }
        const points = pathValues(c, p, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
        onPath(points, clamp(local, 0, 1), point);
        for (let k = 0; k < 3; k++) {
          const target = point[k] + c.hitRel[i * 3 + k];
          const d = (target - c.xyz[i * 3 + k]) * strength;
          c.xyz[i * 3 + k] += d; c.prev[i * 3 + k] += d;
        }
      }
    },
  });
});

register("Movement Maintain Position Along Path", (a) => {
  const path = pathOf(a), maxDistance = a.num("maximum distance"), count = Math.max(2, a.int("particles to map from start to end", 20));
  const loop = a.bool("restart behavior (0 = bounce, 1 = loop )"), cohesion = a.num("cohesion strength", 1), useExisting = a.bool("use existing particle count");
  return fn(a, {
    operate(c, strength) {
      const bulgeDir: Vec3 = [0, 0, 1];
      const points = pathValues(c, path, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bulgeDir);
      const total = useExisting ? Math.max(2, c.n) : count;
      for (let i = 0; i < c.n; i++) {
        const k = useExisting ? i : (c.id[i] | 0);
        let step = k % (loop ? total : total * 2 - 2 || 1);
        if (!loop && step >= total) step = total * 2 - 2 - step;
        onPath(points, step / (total - 1), point);
        for (let m = 0; m < 3; m++) {
          let delta = point[m] - c.xyz[i * 3 + m];
          if (maxDistance > 0 && Math.abs(delta) < maxDistance) delta *= 0;
          const d = delta * clamp(cohesion * strength, 0, 1);
          c.xyz[i * 3 + m] += d; c.prev[i * 3 + m] += d;
        }
      }
    },
  });
});

register("Constrain distance to path between two control points", (a) => {
  const path = pathOf(a);
  const randomBulge = a.num("random bulge"), travel = a.num("travel time", 1);
  const max = a.num("maximum distance"), maxMiddle = a.num("maximum distance middle", -1), maxEnd = a.num("maximum distance end", -1), min = a.num("minimum distance");
  const salt = Math.random();
  void salt;
  return fn(a, {
    constrain(c) {
      const bulge: Vec3 = [c.rand(-1, 1), c.rand(-1, 1), c.rand(-1, 1)];
      normalize(bulge);
      const p = { ...path, bulge: path.bulge || randomBulge };
      const points = pathValues(c, p, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bulge);
      let moved = false;
      for (let i = 0; i < c.n; i++) {
        const t = travel > 0 ? clamp((c.time - c.creation[i]) / travel, 0, 1) : 1;
        onPath(points, t, point);
        const mid = maxMiddle < 0 ? max : maxMiddle, end = maxEnd < 0 ? max : maxEnd;
        const reach = t < 0.5 ? lerp(max, mid, t * 2) : lerp(mid, end, (t - 0.5) * 2);
        const dx = c.xyz[i * 3] - point[0], dy = c.xyz[i * 3 + 1] - point[1], dz = c.xyz[i * 3 + 2] - point[2];
        const d = Math.hypot(dx, dy, dz);
        const target = d > reach ? reach : d < min ? min : d;
        if (target === d) continue;
        const s = d > 1e-9 ? target / d : 0;
        c.xyz[i * 3] = point[0] + dx * s; c.xyz[i * 3 + 1] = point[1] + dy * s; c.xyz[i * 3 + 2] = point[2] + dz * s;
        moved = true;
      }
      return moved;
    },
  });
});
