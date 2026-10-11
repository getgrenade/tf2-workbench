import { fn, register, type Collection } from "./collection";
import type { Attrs, Vec3 } from "./attrs";
import { noise4 } from "./noise";
import { RAD, clamp, field, initialField, lerp, normalize, remap, remapClamped } from "./util";

/**
 * The initializers: they set the attributes of the particles an emitter just made. A velocity is kept the way the movement operator reads it:
 * as the distance between the previous position and the position (`prev = xyz - velocity * dt`), so adding a velocity subtracts it from prev.
 */

const tmp: Vec3 = [0, 0, 0], tmp2: Vec3 = [0, 0, 0], tmp3: Vec3 = [0, 0, 0];

function addVelocity(c: Collection, i: number, v: Vec3) {
  c.prev[i * 3] -= v[0] * c.dt; c.prev[i * 3 + 1] -= v[1] * c.dt; c.prev[i * 3 + 2] -= v[2] * c.dt;
}
function movePosition(c: Collection, i: number, p: Vec3) {
  for (let k = 0; k < 3; k++) { c.xyz[i * 3 + k] += p[k]; c.prev[i * 3 + k] += p[k]; }
}

/** The window of the system's own time in which an initializer acts (Remap ops: -1 means always). */
function inWindow(c: Collection, start: number, end: number): boolean {
  if (start >= 0 && c.time < start) return false;
  if (end >= 0 && c.time > end) return false;
  return true;
}

// ----------------------------------------------------------------------------------------------------------------------------------------
// position
function sphere(a: Attrs, legacy: boolean) {
  void legacy;
  const cp = a.int("control_point_number");
  const dMin = a.num("distance_min"), dMax = a.num("distance_max");
  const bias = a.vec("distance_bias", [1, 1, 1]), biasAbs = a.vec("distance_bias_absolute_value");
  const local = a.bool("bias in local system");
  const sMin = a.num("speed_min"), sMax = a.num("speed_max"), sExp = a.num("speed_random_exponent", 1);
  const lMin = a.vec("speed_in_local_coordinate_system_min"), lMax = a.vec("speed_in_local_coordinate_system_max");
  const toHighest = a.bool("randomly distribute to highest supplied Control Point"), growth = a.num("randomly distribution growth time");
  const inModel = a.int("create in model");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        let from = cp;
        if (toHighest) {
          // spread over the control points up to the highest one given (growing over `growth` seconds)
          const top = growth > 0 ? Math.min(c.highestCP, Math.floor(c.highestCP * Math.min(1, c.time / growth))) : c.highestCP;
          from = c.randInt(cp, Math.max(cp, top));
        }
        const len = Math.sqrt(c.randInUnitSphere(tmp));
        const dir: Vec3 = [tmp[0], tmp[1], tmp[2]];
        if (len > 1e-9) { dir[0] /= len; dir[1] /= len; dir[2] /= len; }
        const dist = dMin + (dMax - dMin) * len;
        const offset: Vec3 = [dir[0] * dist, dir[1] * dist, dir[2] * dist];
        for (let k = 0; k < 3; k++) {
          offset[k] *= bias[k];
          if (biasAbs[k] !== 0) offset[k] = Math.abs(offset[k]) * Math.sign(biasAbs[k]);
        }
        const place: Vec3 = local || true ? c.cpTransform(from, offset, tmp2) : offset;
        let world: Vec3 = [place[0], place[1], place[2]];
        if (inModel && c.world.boxes.length && c.cps[from].object) {
          const box = c.world.boxes[c.randInt(0, c.world.boxes.length - 1)];
          const l: Vec3 = [lerp(box.mins[0], box.maxs[0], c.rand()), lerp(box.mins[1], box.maxs[1], c.rand()), lerp(box.mins[2], box.maxs[2], c.rand())];
          const m = box.transform;
          world = [m[0] * l[0] + m[1] * l[1] + m[2] * l[2] + m[3], m[4] * l[0] + m[5] * l[1] + m[6] * l[2] + m[7], m[8] * l[0] + m[9] * l[1] + m[10] * l[2] + m[11]];
        }
        c.xyz[i * 3] = world[0]; c.xyz[i * 3 + 1] = world[1]; c.xyz[i * 3 + 2] = world[2];
        c.prev[i * 3] = world[0]; c.prev[i * 3 + 1] = world[1]; c.prev[i * 3 + 2] = world[2];
        // velocity: along the random direction, then in the local frame of the control point
        const speed = sMax !== sMin || sMin !== 0 ? c.randExp(sMin, sMax, sExp) : 0;
        const v: Vec3 = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
        if (lMin.some((x) => x !== 0) || lMax.some((x) => x !== 0)) {
          const lv = c.randVec(lMin, lMax, tmp3);
          const world3 = c.cpRotate(from, lv, [0, 0, 0]);
          v[0] += world3[0]; v[1] += world3[1]; v[2] += world3[2];
        }
        addVelocity(c, i, v);
      }
    },
  });
}
register(["Position Within Sphere Random", "position_within_sphere"], (a) => sphere(a, false));

register("Position Within Box Random", (a) => {
  const min = a.vec("min"), max = a.vec("max"), cp = a.int("control point number");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const l = c.randVec(min, max, tmp);
        const p = c.cpTransform(cp, l, tmp2);
        for (let k = 0; k < 3; k++) { c.xyz[i * 3 + k] = p[k]; c.prev[i * 3 + k] = p[k]; }
      }
    },
  });
});

register("Position Modify Offset Random", (a) => {
  const cp = a.int("control_point_number"), min = a.vec("offset min"), max = a.vec("offset max");
  const local = a.bool("offset in local space 0/1"), byRadius = a.bool("offset proportional to radius 0/1");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const o = c.randVec(min, max, tmp);
        if (byRadius) { const r = c.radius[i]; o[0] *= r; o[1] *= r; o[2] *= r; }
        const w = local ? c.cpRotate(cp, o, tmp2) : o;
        movePosition(c, i, w);
      }
    },
  });
});

register("Position Modify Warp Random", (a) => {
  const cp = a.int("control point number"), min = a.vec("warp min", [1, 1, 1]), max = a.vec("warp max", [1, 1, 1]);
  const transitionTime = a.num("warp transition time (treats min/max as start/end sizes)"), transitionStart = a.num("warp transition start time");
  const reverse = a.bool("reverse warp (0/1)");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const warp: Vec3 = [0, 0, 0];
        if (transitionTime > 0) {
          const t = clamp((c.time - transitionStart) / transitionTime, 0, 1);
          for (let k = 0; k < 3; k++) warp[k] = lerp(min[k], max[k], t);
        } else c.randVec(min, max, warp);
        const origin = c.cps[cp].pos;
        for (let k = 0; k < 3; k++) {
          const rel = c.xyz[i * 3 + k] - origin[k];
          const scaled = reverse ? rel / (warp[k] || 1) : rel * warp[k];
          const delta = origin[k] + scaled - c.xyz[i * 3 + k];
          c.xyz[i * 3 + k] += delta; c.prev[i * 3 + k] += delta;
        }
      }
    },
  });
});

register("Position on Model Random", (a) => {
  const cp = a.int("control_point_number"), bias = a.vec("direction bias"), scale = a.num("hitbox scale", 1), tries = a.int("force to be inside model");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const base = c.cps[cp].pos;
        const boxes = c.world.boxes;
        let best = -Infinity;
        let point: Vec3 = [base[0], base[1], base[2]], rel: Vec3 = [0, 0, 0], index = -1;
        if (boxes.length && c.cps[cp].object) {
          const attempts = 1 + (bias[0] === 0 && bias[1] === 0 && bias[2] === 0 ? tries : Math.max(tries, 5));
          for (let k = 0; k < attempts; k++) {
            const bi = c.randInt(0, boxes.length - 1), box = boxes[bi];
            const u = c.rand(1 - scale, scale), v = c.rand(1 - scale, scale), w = c.rand(1 - scale, scale);
            const l: Vec3 = [box.mins[0] + u * (box.maxs[0] - box.mins[0]), box.mins[1] + v * (box.maxs[1] - box.mins[1]), box.mins[2] + w * (box.maxs[2] - box.mins[2])];
            const m = box.transform;
            const p: Vec3 = [m[0] * l[0] + m[1] * l[1] + m[2] * l[2] + m[3], m[4] * l[0] + m[5] * l[1] + m[6] * l[2] + m[7], m[8] * l[0] + m[9] * l[1] + m[10] * l[2] + m[11]];
            const goodness = c.rand(0, 72) + (p[0] - base[0]) * bias[0] + (p[1] - base[1]) * bias[1] + (p[2] - base[2]) * bias[2];
            if (goodness > best) { best = goodness; point = p; rel = [u, v, w]; index = bi; }
          }
        }
        for (let k = 0; k < 3; k++) { c.xyz[i * 3 + k] = point[k]; c.prev[i * 3 + k] = point[k]; c.hitRel[i * 3 + k] = rel[k]; }
        c.hitbox[i] = index;
      }
    },
  });
});

register("Position From Parent Particles", (a) => {
  const scale = a.num("Inherited Velocity Scale", 1), random = a.bool("Random Parent Particle Distribution");
  let next = 0;
  return fn(a, {
    initialize(c, first, n) {
      const p = c.parent;
      for (let i = first; i < first + n; i++) {
        // without a particle of the parent to start from there is no particle
        if (!p || p.n === 0) { c.killParticle(i); continue; }
        const j = random ? c.randInt(0, p.n - 1) : (next++ % p.n);
        for (let k = 0; k < 3; k++) {
          c.xyz[i * 3 + k] = p.xyz[j * 3 + k];
          // the parent's velocity, scaled
          const v = (p.xyz[j * 3 + k] - p.prev[j * 3 + k]) * scale;
          c.prev[i * 3 + k] = p.xyz[j * 3 + k] - v;
        }
      }
    },
    restart() { next = 0; },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// velocity
register("Velocity Random", (a) => {
  const cp = a.int("control_point_number"), sMin = a.num("random_speed_min"), sMax = a.num("random_speed_max");
  const lMin = a.vec("speed_in_local_coordinate_system_min"), lMax = a.vec("speed_in_local_coordinate_system_max");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const v: Vec3 = [0, 0, 0];
        if (sMin !== 0 || sMax !== 0) {
          c.randInUnitSphere(tmp);
          normalize(tmp);
          const s = c.rand(sMin, sMax);
          v[0] = tmp[0] * s; v[1] = tmp[1] * s; v[2] = tmp[2] * s;
        }
        const lv = c.randVec(lMin, lMax, tmp2);
        const w = c.cpRotate(cp, lv, tmp3);
        v[0] += w[0]; v[1] += w[1]; v[2] += w[2];
        addVelocity(c, i, v);
      }
    },
  });
});

register("Velocity Inherit from Control Point", (a) => {
  const cp = a.int("control point number"), scale = a.num("velocity scale", 1);
  return fn(a, {
    initialize(c, first, n) {
      const v = c.cps[cp].velocity;
      const w: Vec3 = [v[0] * scale, v[1] * scale, v[2] * scale];
      for (let i = first; i < first + n; i++) addVelocity(c, i, w);
    },
  });
});

function noiseVelocity(a: Attrs, initial: boolean) {
  const cp = a.int(initial ? "Control Point Number" : "Control Point Number");
  const timeScale = a.num("Time Noise Coordinate Scale", 1), spatialScale = a.num("Spatial Noise Coordinate Scale", 0.01);
  const timeOffset = a.num("Time Coordinate Offset"), spatialOffset = a.vec("Spatial Coordinate Offset");
  const abs = a.vec("Absolute Value"), invert = a.vec("Invert Abs Value");
  const min = a.vec("output minimum"), max = a.vec("output maximum");
  const local = a.bool("Apply Velocity in Local Space (0/1)");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const v: Vec3 = [0, 0, 0];
        const px = c.xyz[i * 3] * spatialScale + spatialOffset[0], py = c.xyz[i * 3 + 1] * spatialScale + spatialOffset[1], pz = c.xyz[i * 3 + 2] * spatialScale + spatialOffset[2];
        const t = c.time * timeScale + timeOffset;
        for (let k = 0; k < 3; k++) {
          let s = noise4(px + k * 17.3, py - k * 9.1, pz + k * 5.7, t);
          s = s * 0.5 + 0.5;
          if (abs[k] !== 0) s = Math.abs(s * 2 - 1);
          if (invert[k] !== 0) s = 1 - s;
          v[k] = lerp(min[k], max[k], clamp(s, 0, 1));
        }
        addVelocity(c, i, local ? c.cpRotate(cp, v, tmp) : v);
      }
    },
  });
}
register("Velocity Noise", (a) => noiseVelocity(a, false));
register("Initial Velocity Noise", (a) => noiseVelocity(a, true));

// ----------------------------------------------------------------------------------------------------------------------------------------
// scalar attributes
register(["Lifetime Random", "lifetime_random"], (a) => {
  const min = a.num("lifetime_min", 0), max = a.num("lifetime_max", 0), e = a.num("lifetime_random_exponent", 1);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.life[i] = Math.max(1e-3, c.randExp(min, max, e)); } });
});
register(["Alpha Random", "alpha_random"], (a) => {
  const min = a.num("alpha_min", 255), max = a.num("alpha_max", 255), e = a.num("alpha_random_exponent", 1);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.alpha[i] = clamp(c.randExp(min, max, e) / 255, 0, 1); } });
});
register(["Radius Random", "radius_random"], (a) => {
  const min = a.num("radius_min", 1), max = a.num("radius_max", 1), e = a.num("radius_random_exponent", 1);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.radius[i] = c.randExp(min, max, e); } });
});
register(["Rotation Random", "rotation_random"], (a) => {
  const initial = a.num("rotation_initial"), min = a.num("rotation_offset_min"), max = a.num("rotation_offset_max"), e = a.num("rotation_random_exponent", 1);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.rotation[i] = (initial + c.randExp(min, max, e)) * RAD; } });
});
register("Rotation Speed Random", (a) => {
  const constant = a.num("rotation_speed_constant"), min = a.num("rotation_speed_random_min"), max = a.num("rotation_speed_random_max");
  const e = a.num("rotation_speed_random_exponent", 1), flip = a.bool("randomly_flip_direction");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        let s = (constant + c.randExp(min, max, e)) * RAD;
        if (flip && c.rand() < 0.5) s = -s;
        c.rotSpeed[i] = s;
      }
    },
  });
});
register("Rotation Yaw Random", (a) => {
  const initial = a.num("yaw_initial"), min = a.num("yaw_offset_min"), max = a.num("yaw_offset_max"), e = a.num("yaw_random_exponent", 1);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.yaw[i] = (initial + c.randExp(min, max, e)) * RAD; } });
});
register("Rotation Yaw Flip Random", (a) => {
  const flip = a.num("Flip Percentage", 0.5);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) if (c.rand() < flip) c.yaw[i] += Math.PI; } });
});
register("Sequence Random", (a) => {
  const min = a.int("sequence_min"), max = a.int("sequence_max");
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.seq[i] = c.randInt(min, max); } });
});
register("Sequence Two Random", (a) => {
  const min = a.int("sequence_min"), max = a.int("sequence_max");
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) { c.seq[i] = c.randInt(min, max); c.seq1[i] = c.randInt(min, max); } } });
});
register(["Trail Length Random", "trail_length_random"], (a) => {
  const min = a.num("length_min", 0.1), max = a.num("length_max", 0.1), e = a.num("length_random_exponent", 1);
  return fn(a, { initialize(c, first, n) { for (let i = first; i < first + n; i++) c.trail[i] = c.randExp(min, max, e); } });
});

register(["Color Random", "color_random"], (a) => {
  const c1 = a.color("color1"), c2 = a.color("color2"), tintPct = a.num("tint_perc"), tintCp = a.int("tint control point");
  const clampMin = a.color("tint clamp min", [0, 0, 0, 0]), clampMax = a.color("tint clamp max", [255, 255, 255, 255]);
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        const t = c.rand();
        const rgb = [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
        if (tintPct > 0) {
          // the position of the tint control point holds a colour (0..255)
          const p = c.cps[tintCp].pos;
          for (let k = 0; k < 3; k++) rgb[k] = lerp(rgb[k], clamp(p[k], clampMin[k], clampMax[k]), tintPct);
        }
        c.rgb[i * 3] = rgb[0] / 255; c.rgb[i * 3 + 1] = rgb[1] / 255; c.rgb[i * 3 + 2] = rgb[2] / 255;
      }
    },
  });
});

register("Lifetime Pre-Age Noise", (a) => {
  const timeScale = a.num("time noise coordinate scale", 1), spatialScale = a.num("spatial noise coordinate scale", 1);
  const timeOffset = a.num("time coordinate offset"), spatialOffset = a.vec("spatial coordinate offset");
  const abs = a.bool("absolute value"), invert = a.bool("invert absolute value");
  const min = a.num("start age minimum"), max = a.num("start age maximum");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        let s = noise4(c.xyz[i * 3] * spatialScale + spatialOffset[0], c.xyz[i * 3 + 1] * spatialScale + spatialOffset[1], c.xyz[i * 3 + 2] * spatialScale + spatialOffset[2], c.time * timeScale + timeOffset);
        s = abs ? Math.abs(s) : s * 0.5 + 0.5;
        if (invert) s = 1 - s;
        // the particle starts that old: its creation time lies in the past
        c.creation[i] = c.time - lerp(min, max, clamp(s, 0, 1));
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// remap
function remapTarget(c: Collection, i: number, id: number, value: number | Vec3, scaleInitial: boolean) {
  const f = field(c, id);
  if (!f) return;
  const set = (k: number, v: number) => {
    const at = i * f.size + k;
    f.array[at] = scaleInitial ? f.array[at] * v : v;
  };
  if (typeof value === "number") { set(0, value); if (f.size === 3) { set(1, value); set(2, value); } }
  else for (let k = 0; k < f.size; k++) set(k, value[k]);
  if (id === 7 || id === 16) f.array[i] = clamp(f.array[i], 0, 1);
}

register(["Remap Initial Scalar", "remap initial scalar"], (a) => {
  const start = a.num("emitter lifetime start time (seconds)", -1), end = a.num("emitter lifetime end time (seconds)", -1);
  const inField = a.int("input field"), outField = a.int("output field");
  const inMin = a.num("input minimum"), inMax = a.num("input maximum"), outMin = a.num("output minimum"), outMax = a.num("output maximum");
  const scale = a.bool("output is scalar of initial random range"), only = a.bool("only active within specified input range");
  return fn(a, {
    initialize(c, first, n) {
      if (!inWindow(c, start, end)) return;
      const src = field(c, inField);
      if (!src) return;
      for (let i = first; i < first + n; i++) {
        const v = src.array[i * src.size];
        if (only && (v < Math.min(inMin, inMax) || v > Math.max(inMin, inMax))) continue;
        remapTarget(c, i, outField, remapClamped(v, inMin, inMax, outMin, outMax), scale);
      }
    },
  });
});

register(["Remap Control Point to Scalar"], (a) => {
  const start = a.num("emitter lifetime start time (seconds)", -1), end = a.num("emitter lifetime end time (seconds)", -1);
  const cp = a.int("input control point number"), comp = a.int("input field 0-2 X/Y/Z"), outField = a.int("output field");
  const inMin = a.num("input minimum"), inMax = a.num("input maximum"), outMin = a.num("output minimum"), outMax = a.num("output maximum");
  const scale = a.bool("output is scalar of initial random range");
  return fn(a, {
    initialize(c, first, n) {
      if (!inWindow(c, start, end)) return;
      const v = remapClamped(c.cps[cp].pos[clamp(comp, 0, 2)], inMin, inMax, outMin, outMax);
      for (let i = first; i < first + n; i++) remapTarget(c, i, outField, v, scale);
    },
  });
});

register(["Remap Control Point to Vector", "remap control point to Vector"], (a) => {
  const start = a.num("emitter lifetime start time (seconds)", -1), end = a.num("emitter lifetime end time (seconds)", -1);
  const cp = a.int("input control point number"), outField = a.int("output field"), localCp = a.int("local space CP", -1);
  const inMin = a.vec("input minimum"), inMax = a.vec("input maximum"), outMin = a.vec("output minimum"), outMax = a.vec("output maximum");
  const scale = a.bool("output is scalar of initial random range"), offset = a.bool("offset position"), accelerate = a.bool("accelerate position");
  return fn(a, {
    initialize(c, first, n) {
      if (!inWindow(c, start, end)) return;
      const p = c.cps[cp].pos;
      const out: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) out[k] = remapClamped(p[k], inMin[k], inMax[k], outMin[k], outMax[k]);
      const world = localCp >= 0 && outField === 0 ? c.cpRotate(localCp, out, tmp) : out;
      for (let i = first; i < first + n; i++) {
        if (outField === 0 && (offset || accelerate)) {
          if (offset) movePosition(c, i, world);
          if (accelerate) addVelocity(c, i, world);
        } else remapTarget(c, i, outField, world, scale);
      }
    },
  });
});

register(["Remap Scalar to Vector", "remap scalar to vector"], (a) => {
  const start = a.num("emitter lifetime start time (seconds)", -1), end = a.num("emitter lifetime end time (seconds)", -1);
  const inField = a.int("input field"), outField = a.int("output field"), cp = a.int("control_point_number"), local = a.bool("use local system");
  const inMin = a.num("input minimum"), inMax = a.num("input maximum"), outMin = a.vec("output minimum"), outMax = a.vec("output maximum");
  const scale = a.bool("output is scalar of initial random range");
  return fn(a, {
    initialize(c, first, n) {
      if (!inWindow(c, start, end)) return;
      const src = field(c, inField);
      if (!src) return;
      for (let i = first; i < first + n; i++) {
        const t = clamp(remap(src.array[i * src.size], inMin, inMax, 0, 1), 0, 1);
        const v: Vec3 = [lerp(outMin[0], outMax[0], t), lerp(outMin[1], outMax[1], t), lerp(outMin[2], outMax[2], t)];
        const world = local && outField === 0 ? c.cpRotate(cp, v, tmp) : v;
        remapTarget(c, i, outField, world, scale);
      }
    },
  });
});

register("Remap Initial Distance to Control Point to Scalar", (a) => {
  const cp = a.int("control point"), outField = a.int("output field");
  const dMin = a.num("distance minimum"), dMax = a.num("distance maximum"), outMin = a.num("output minimum"), outMax = a.num("output maximum");
  const scale = a.bool("output is scalar of initial random range"), only = a.bool("only active within specified distance");
  return fn(a, {
    initialize(c, first, n) {
      const p = c.cps[cp].pos;
      for (let i = first; i < first + n; i++) {
        const d = Math.hypot(c.xyz[i * 3] - p[0], c.xyz[i * 3 + 1] - p[1], c.xyz[i * 3 + 2] - p[2]);
        if (only && (d < Math.min(dMin, dMax) || d > Math.max(dMin, dMax))) continue;
        remapTarget(c, i, outField, remapClamped(d, dMin, dMax, outMin, outMax), scale);
      }
    },
  });
});

register("Remap Noise to Scalar", (a) => {
  const timeScale = a.num("time noise coordinate scale", 1), spatialScale = a.num("spatial noise coordinate scale", 1);
  const timeOffset = a.num("time coordinate offset"), spatialOffset = a.vec("spatial coordinate offset");
  const abs = a.bool("absolute value"), invert = a.bool("invert absolute value"), outField = a.int("output field");
  const outMin = a.num("output minimum"), outMax = a.num("output maximum"), worldTime = a.num("world time noise coordinate scale");
  return fn(a, {
    initialize(c, first, n) {
      for (let i = first; i < first + n; i++) {
        let s = noise4(c.xyz[i * 3] * spatialScale + spatialOffset[0], c.xyz[i * 3 + 1] * spatialScale + spatialOffset[1], c.xyz[i * 3 + 2] * spatialScale + spatialOffset[2], c.time * timeScale + timeOffset + (worldTime ? c.time * worldTime : 0));
        s = abs ? Math.abs(s) : s * 0.5 + 0.5;
        if (invert) s = 1 - s;
        remapTarget(c, i, outField, lerp(outMin, outMax, clamp(s, 0, 1)), false);
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// lifetime from other things
register(["Lifetime From Sequence", "lifetime from sequence"], (a) => {
  const fps = a.num("Frames Per Second", 30);
  return fn(a, {
    initialize(c, first, n) {
      const sheet = c.sheet;
      for (let i = first; i < first + n; i++) {
        const frames = sheet ? sheet(Math.round(c.seq[i])) : 0;
        if (frames > 0 && fps > 0) c.life[i] = frames / fps;
      }
    },
  });
});

register("Lifetime From Control Point Life Time", (a) => {
  const first0 = a.int("starting control point"), last = a.int("maximum end control point", 30);
  return fn(a, {
    initialize(c, first, n) {
      const cp = clamp(c.targetCP, first0, last);
      const d = c.cps[cp]?.duration ?? 0;
      if (d > 0) for (let i = first; i < first + n; i++) c.life[i] = d;
    },
  });
});

register("Assign target CP", (a) => {
  const first0 = a.int("starting control point"), last = a.int("maximum end control point", 30);
  return fn(a, {
    initialize(c, first, n) {
      const cp = clamp(c.targetCP, first0, last);
      for (let i = first; i < first + n; i++) c.cpIndex[i] = cp;
    },
  });
});

void initialField;
