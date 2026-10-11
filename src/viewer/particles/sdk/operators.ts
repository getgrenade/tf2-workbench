import { fn, register, type Collection } from "./collection";
import type { Attrs, Vec3 } from "./attrs";
import { noise4 } from "./noise";
import { RAD, clamp, field, initialField, lerp, normalize, remap, remapClamped, smooth } from "./util";

/**
 * The operators: they change the particles every step, in the order of the definition. The movement operator is the integrator (position
 * based Verlet, as in the engine: a particle's velocity is the difference between its position and its previous one), it applies the
 * forces and then the constraints.
 */

/** Valve's Bias(): bends 0..1 so that 0.5 is the middle (below 0.5 it lingers low, above it rises early). */
export function bias(x: number, b: number): number {
  // (a bias outside 0..1 is no bias: the engine leaves such a curve straight)
  if (b === 0.5 || !(b > 0 && b < 1) || x <= 0 || x >= 1) return clamp(x, 0, 1);
  return Math.pow(x, Math.log(b) * -1.4427);
}
const ramp = (v: number, a: number, b: number) => (b === a ? (v >= b ? 1 : 0) : clamp((v - a) / (b - a), 0, 1));

/** A random number tied to a particle and a function (the engine's per particle random: the same particle always draws the same). */
export function particleRandom(c: Collection, i: number, salt: number): number {
  let h = (Math.imul((c.id[i] | 0) + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b) ^ Math.imul(c.seed + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}
let saltCounter = 1;
const nextSalt = () => saltCounter++;

const v3: Vec3 = [0, 0, 0];

// ----------------------------------------------------------------------------------------------------------------------------------------
// movement
register(["Movement Basic", "basic_movement"], (a) => {
  const gravity = a.vec("gravity"), drag = a.num("drag"), passes = Math.max(1, a.int("max constraint passes", 3));
  return fn(a, {
    operate(c, strength) {
      const dt = c.dt;
      const f = Math.pow(1 - drag, dt * 30);
      const dt2 = dt * dt;
      const forces = c.forceField;
      for (let i = 0; i < c.n; i++) {
        for (let k = 0; k < 3; k++) {
          const at = i * 3 + k;
          const x = c.xyz[at];
          c.xyz[at] = x + (x - c.prev[at]) * f + (gravity[k] * strength + forces[at]) * dt2;
          c.prev[at] = x;
        }
      }
      c.runConstraints(passes);
    },
  });
});

register("Movement Lock to Control Point", (a) => positionLock(a));
register("postion_lock_to_controlpoint", (a) => positionLock(a));
function positionLock(a: Attrs) {
  const cp = a.int("control_point_number");
  const sMin = a.num("start_fadeout_min", 1), sMax = a.num("start_fadeout_max", 1), sExp = a.num("start_fadeout_exponent", 1);
  const eMin = a.num("end_fadeout_min", 1), eMax = a.num("end_fadeout_max", 1), eExp = a.num("end_fadeout_exponent", 1);
  const range = a.num("distance fade range"), lockRotation = a.bool("lock rotation");
  const salt = nextSalt();
  let last: Vec3 | null = null;
  return fn(a, {
    operate(c, strength) {
      const now = c.cps[cp].pos;
      if (!last) last = [now[0], now[1], now[2]];
      const dx = now[0] - last[0], dy = now[1] - last[1], dz = now[2] - last[2];
      last[0] = now[0]; last[1] = now[1]; last[2] = now[2];
      void lockRotation;
      for (let i = 0; i < c.n; i++) {
        const life = c.life[i] || 1;
        const frac = (c.time - c.creation[i]) / life;
        const start = lerp(sMin, sMax, Math.pow(particleRandom(c, i, salt), sExp));
        const end = lerp(eMin, eMax, Math.pow(particleRandom(c, i, salt + 7919), eExp));
        let s = frac <= start ? 1 : 1 - ramp(frac, start, Math.max(start, end));
        if (range > 0) {
          const d = Math.hypot(c.xyz[i * 3] - now[0], c.xyz[i * 3 + 1] - now[1], c.xyz[i * 3 + 2] - now[2]);
          s *= 1 - clamp(d / range, 0, 1);
        }
        s *= strength;
        c.xyz[i * 3] += dx * s; c.xyz[i * 3 + 1] += dy * s; c.xyz[i * 3 + 2] += dz * s;
        c.prev[i * 3] += dx * s; c.prev[i * 3 + 1] += dy * s; c.prev[i * 3 + 2] += dz * s;
      }
    },
    restart() { last = null; },
  });
}

register("Movement Max Velocity", (a) => {
  const max = a.num("Maximum Velocity");
  return fn(a, {
    operate(c) {
      const limit = max * c.dt;
      for (let i = 0; i < c.n; i++) {
        const dx = c.xyz[i * 3] - c.prev[i * 3], dy = c.xyz[i * 3 + 1] - c.prev[i * 3 + 1], dz = c.xyz[i * 3 + 2] - c.prev[i * 3 + 2];
        const l = Math.hypot(dx, dy, dz);
        if (l > limit && l > 0) {
          // the step just taken is cut short: the particle is put back along it
          const s = limit / l;
          c.xyz[i * 3] = c.prev[i * 3] + dx * s; c.xyz[i * 3 + 1] = c.prev[i * 3 + 1] + dy * s; c.xyz[i * 3 + 2] = c.prev[i * 3 + 2] + dz * s;
        }
      }
    },
  });
});

register("Movement Dampen Relative to Control Point", (a) => {
  const cp = a.int("control_point_number"), range = a.num("falloff range", 1), scale = a.num("dampen scale", 1);
  return fn(a, {
    operate(c, strength) {
      const p = c.cps[cp].pos;
      for (let i = 0; i < c.n; i++) {
        const d = Math.hypot(c.xyz[i * 3] - p[0], c.xyz[i * 3 + 1] - p[1], c.xyz[i * 3 + 2] - p[2]);
        // inside the range the velocity is damped, more the closer the particle is to the control point
        if (range <= 0 || d >= range) continue;
        const f = 1 - (1 - d / range) * clamp(scale, 0, 1) * strength;
        for (let k = 0; k < 3; k++) { const at = i * 3 + k; c.prev[at] = c.xyz[at] - (c.xyz[at] - c.prev[at]) * f; }
      }
    },
  });
});

register("Movement Rotate Particle Around Axis", (a) => {
  const axis = a.vec("Rotation Axis", [0, 0, 1]), rate = a.num("Rotation Rate"), cp = a.int("Control Point"), local = a.bool("Use Local Space");
  return fn(a, {
    operate(c, strength) {
      const ax: Vec3 = local ? c.cpRotate(cp, axis, [0, 0, 0]) : [axis[0], axis[1], axis[2]];
      normalize(ax);
      const center = c.cps[cp].pos;
      const angle = rate * RAD * c.dt * strength;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rot = (x: number, y: number, z: number, out: Float32Array, at: number) => {
        // Rodrigues' rotation about ax through the control point
        const px = x - center[0], py = y - center[1], pz = z - center[2];
        const d = ax[0] * px + ax[1] * py + ax[2] * pz;
        out[at] = center[0] + px * cos + (ax[1] * pz - ax[2] * py) * sin + ax[0] * d * (1 - cos);
        out[at + 1] = center[1] + py * cos + (ax[2] * px - ax[0] * pz) * sin + ax[1] * d * (1 - cos);
        out[at + 2] = center[2] + pz * cos + (ax[0] * py - ax[1] * px) * sin + ax[2] * d * (1 - cos);
      };
      for (let i = 0; i < c.n; i++) {
        rot(c.xyz[i * 3], c.xyz[i * 3 + 1], c.xyz[i * 3 + 2], c.xyz, i * 3);
        rot(c.prev[i * 3], c.prev[i * 3 + 1], c.prev[i * 3 + 2], c.prev, i * 3);
      }
    },
  });
});

register("Movement Follow CP", (a) => {
  const first0 = a.int("starting control point"), last = a.int("maximum end control point", 30);
  const catchUp = a.num("catch up speed"), lerpSpeed = a.num("lerp to CP radius speed"), updateLife = a.bool("update particle life time");
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const cpi = clamp(Math.round(c.cpIndex[i]), first0, Math.min(last, 63));
        const cp = c.cps[cpi];
        let move = catchUp > 0 ? catchUp * c.dt : Infinity;
        for (let k = 0; k < 3; k++) {
          const delta = cp.pos[k] - c.xyz[i * 3 + k];
          const step = Math.abs(delta) > move ? Math.sign(delta) * move : delta;
          c.xyz[i * 3 + k] += step;
          c.prev[i * 3 + k] += step;
        }
        if (lerpSpeed > 0 && cp.radius > 0) c.radius[i] += clamp(cp.radius - c.radius[i], -lerpSpeed * c.dt, lerpSpeed * c.dt);
        if (updateLife && cp.duration > 0) c.life[i] = cp.duration;
        void move;
      }
    },
  });
});

register("Movement Match Particle Velocities", (a) => {
  const dirStrength = a.num("Direction Matching Strength"), speedStrength = a.num("Speed Matching Strength"), broadcast = a.int("Control Point to Broadcast Speed and Direction To", -1);
  return fn(a, {
    operate(c) {
      if (c.n < 2) return;
      let ax = 0, ay = 0, az = 0, sp = 0;
      for (let i = 0; i < c.n; i++) { const dx = c.xyz[i * 3] - c.prev[i * 3], dy = c.xyz[i * 3 + 1] - c.prev[i * 3 + 1], dz = c.xyz[i * 3 + 2] - c.prev[i * 3 + 2]; ax += dx; ay += dy; az += dz; sp += Math.hypot(dx, dy, dz); }
      ax /= c.n; ay /= c.n; az /= c.n; sp /= c.n;
      const al = Math.hypot(ax, ay, az) || 1;
      for (let i = 0; i < c.n; i++) {
        const dx = c.xyz[i * 3] - c.prev[i * 3], dy = c.xyz[i * 3 + 1] - c.prev[i * 3 + 1], dz = c.xyz[i * 3 + 2] - c.prev[i * 3 + 2];
        const l = Math.hypot(dx, dy, dz);
        if (l < 1e-9) continue;
        const dir: Vec3 = [dx / l + (ax / al - dx / l) * dirStrength, dy / l + (ay / al - dy / l) * dirStrength, dz / l + (az / al - dz / l) * dirStrength];
        normalize(dir);
        const nl = lerp(l, sp, speedStrength);
        c.prev[i * 3] = c.xyz[i * 3] - dir[0] * nl; c.prev[i * 3 + 1] = c.xyz[i * 3 + 1] - dir[1] * nl; c.prev[i * 3 + 2] = c.xyz[i * 3 + 2] - dir[2] * nl;
      }
      if (broadcast >= 0) c.setCPVelocity(broadcast, [ax / c.dt, ay / c.dt, az / c.dt]);
    },
  });
});

register("Movement Lock to Bone", (a) => {
  const cp = a.int("control_point_number"), fadeStart = a.num("lifetime fade start"), fadeEnd = a.num("lifetime fade end");
  return fn(a, {
    operate(c, strength) {
      const boxes = c.world.boxes;
      if (!boxes.length || !c.cps[cp].object) return;
      for (let i = 0; i < c.n; i++) {
        const bi = Math.round(c.hitbox[i]);
        const box = boxes[bi];
        if (!box) continue;
        const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
        const s = (fadeEnd > fadeStart ? 1 - ramp(frac, fadeStart, fadeEnd) : 1) * strength;
        if (s <= 0) continue;
        // the particle stays at its place in its hitbox as the character moves
        const rx = c.hitRel[i * 3], ry = c.hitRel[i * 3 + 1], rz = c.hitRel[i * 3 + 2];
        const l: Vec3 = [lerp(box.mins[0], box.maxs[0], rx), lerp(box.mins[1], box.maxs[1], ry), lerp(box.mins[2], box.maxs[2], rz)];
        const m = box.transform;
        const target: Vec3 = [m[0] * l[0] + m[1] * l[1] + m[2] * l[2] + m[3], m[4] * l[0] + m[5] * l[1] + m[6] * l[2] + m[7], m[8] * l[0] + m[9] * l[1] + m[10] * l[2] + m[11]];
        for (let k = 0; k < 3; k++) {
          const d = (target[k] - c.xyz[i * 3 + k]) * s;
          c.xyz[i * 3 + k] += d; c.prev[i * 3 + k] += d;
        }
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// life, alpha, colour, radius
register(["Lifespan Decay", "lifespan_decay"], (a) =>
  fn(a, { operate(c) { for (let i = 0; i < c.n; i++) if (c.time - c.creation[i] >= c.life[i]) c.killParticle(i); } }));

register("Alpha Fade and Decay", (a) => {
  const startAlpha = a.num("start_alpha", 1), endAlpha = a.num("end_alpha", 0);
  const inStart = a.num("start_fade_in_time"), inEnd = a.num("end_fade_in_time"), outStart = a.num("start_fade_out_time", 1), outEnd = a.num("end_fade_out_time", 1);
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
        // (it is also what ends the particle's life)
        if (frac >= 1) { c.killParticle(i); continue; }
        let f = 1;
        if (frac < inEnd) f = lerp(startAlpha, 1, ramp(frac, inStart, inEnd));
        else if (frac > outStart) f = lerp(1, endAlpha, ramp(frac, outStart, outEnd));
        c.alpha[i] = c.initial.alpha[i] * f;
      }
    },
  });
});

register("alpha_fade", (a) => {
  const startAlpha = a.num("start_alpha", 1), endAlpha = a.num("end_alpha", 0);
  const inStart = a.num("start_fade_in_time"), inEnd = a.num("end_fade_in_time"), outStart = a.num("start_fade_out_time", 1), outEnd = a.num("end_fade_out_time", 1);
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
        let f = 1;
        if (frac < inEnd) f = lerp(startAlpha, 1, ramp(frac, inStart, inEnd));
        else if (frac > outStart) f = lerp(1, endAlpha, ramp(frac, outStart, outEnd));
        c.alpha[i] = c.initial.alpha[i] * f;
      }
    },
  });
});

register(["Alpha Fade In Random", "alpha_fade_in_random"], (a) => {
  const min = a.num("fade in time min"), max = a.num("fade in time max"), e = a.num("fade in time exponent", 1), proportional = a.bool("proportional 0/1");
  const curve = a.num("fade in curve exponent", 0);
  const salt = nextSalt();
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        let d = lerp(min, max, Math.pow(particleRandom(c, i, salt), e));
        if (proportional) d *= c.life[i];
        const age = c.time - c.creation[i];
        // (the fade in sets the opacity while it lasts; once it is over the other operators own it)
        if (age >= d) continue;
        let t = ramp(age, 0, d);
        t = curve > 0 ? Math.pow(t, curve) : t * t * (3 - 2 * t);
        c.alpha[i] = c.initial.alpha[i] * t;
      }
    },
  });
});

register(["Alpha Fade Out Random", "alpha_fade_out_random"], (a) => {
  const min = a.num("fade out time min"), max = a.num("fade out time max"), e = a.num("fade out time exponent", 1), proportional = a.bool("proportional 0/1");
  const ease = a.bool("ease in and out"), biasValue = a.num("fade bias", 0.5);
  const salt = nextSalt();
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        let d = lerp(min, max, Math.pow(particleRandom(c, i, salt), e));
        if (proportional) d *= c.life[i];
        const age = c.time - c.creation[i];
        let t = ramp(age, c.life[i] - d, c.life[i]);
        if (ease) t = smooth(t);
        t = bias(t, biasValue);
        c.alpha[i] = Math.min(c.alpha[i], c.initial.alpha[i] * (1 - t));
      }
    },
  });
});

register(["Color Fade", "color_fade"], (a) => {
  const to = a.color("color_fade"), start = a.num("fade_start_time"), end = a.num("fade_end_time", 1), ease = a.bool("ease_in_and_out");
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
        let t = ramp(frac, start, end);
        if (ease) t = smooth(t);
        for (let k = 0; k < 3; k++) c.rgb[i * 3 + k] = lerp(c.initial.rgb[i * 3 + k], to[k] / 255, t);
      }
    },
  });
});

register(["Radius Scale", "radius_scale"], (a) => {
  const start = a.num("start_time"), end = a.num("end_time", 1), s0 = a.num("radius_start_scale", 1), s1 = a.num("radius_end_scale", 1);
  const ease = a.bool("ease_in_and_out"), b = a.num("scale_bias", 0.5);
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
        let t = ramp(frac, start, end);
        if (ease) t = smooth(t);
        t = bias(t, b);
        c.radius[i] = c.initial.radius[i] * lerp(s0, s1, t);
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// rotation
register("Rotation Basic", (a) => fn(a, {
  operate(c, strength) { for (let i = 0; i < c.n; i++) c.rotation[i] += c.rotSpeed[i] * c.dt * strength; },
}));

register(["Rotation Spin Roll", "rotation_spin"], (a) => {
  const rate = a.num("spin_rate_degrees"), stop = a.num("spin_stop_time"), min = a.num("spin_rate_min");
  return fn(a, {
    operate(c, strength) {
      for (let i = 0; i < c.n; i++) {
        let r = rate;
        if (stop > 0) {
          const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
          r = lerp(rate, min, ramp(frac, 0, stop));
        }
        c.rotation[i] += r * RAD * c.dt * strength;
      }
    },
  });
});

register(["Rotation Spin Yaw", "rotation_spin yaw"], (a) => {
  const rate = a.num("yaw_rate_degrees"), stop = a.num("yaw_stop_time"), min = a.num("yaw_rate_min");
  return fn(a, {
    operate(c, strength) {
      for (let i = 0; i < c.n; i++) {
        let r = rate;
        if (stop > 0) {
          const frac = (c.time - c.creation[i]) / (c.life[i] || 1);
          r = lerp(rate, min, ramp(frac, 0, stop));
        }
        c.yaw[i] += r * RAD * c.dt * strength;
      }
    },
  });
});

register("Rotation Orient Relative to CP", (a) => {
  const offset = a.num("Rotation Offset"), spin = a.num("Spin Strength", 1), cp = a.int("Control Point");
  return fn(a, {
    operate(c) {
      const p = c.cps[cp].pos;
      for (let i = 0; i < c.n; i++) {
        const dx = p[0] - c.xyz[i * 3], dy = p[1] - c.xyz[i * 3 + 1];
        // the roll that points the particle at the control point (on screen the particle's axes are the world x and y)
        const target = Math.atan2(dy, dx) + offset * RAD;
        c.rotation[i] = lerp(c.rotation[i], target, clamp(spin, 0, 1));
      }
    },
  });
});

register("Rotation Orient to 2D Direction", (a) => {
  const offset = a.num("Rotation Offset"), spin = a.num("Spin Strength", 1);
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const dx = c.xyz[i * 3] - c.prev[i * 3], dy = c.xyz[i * 3 + 1] - c.prev[i * 3 + 1];
        if (Math.abs(dx) + Math.abs(dy) < 1e-9) continue;
        c.rotation[i] = lerp(c.rotation[i], Math.atan2(dy, dx) + offset * RAD, clamp(spin, 0, 1));
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// oscillation and noise
function oscillator(a: Attrs, vector: boolean) {
  const outField = a.int("oscillation field");
  const rateMin = vector ? a.vec("oscillation rate min") : [a.num("oscillation rate min"), 0, 0];
  const rateMax = vector ? a.vec("oscillation rate max") : [a.num("oscillation rate max"), 0, 0];
  const freqMin = vector ? a.vec("oscillation frequency min", [1, 1, 1]) : [a.num("oscillation frequency min", 1), 1, 1];
  const freqMax = vector ? a.vec("oscillation frequency max", [1, 1, 1]) : [a.num("oscillation frequency max", 1), 1, 1];
  const proportional = a.bool("proportional 0/1"), startEndProportional = a.bool("start/end proportional");
  const startMin = a.num("start time min"), startMax = a.num("start time max"), endMin = a.num("end time min", 1), endMax = a.num("end time max", 1);
  const multiplier = a.num("oscillation multiplier", 2), phase = a.num("oscillation start phase", 0.5);
  const salt = nextSalt();
  return fn(a, {
    operate(c, strength) {
      const f = field(c, outField), init = initialField(c, outField);
      if (!f) return;
      const comps = vector ? f.size : 1;
      for (let i = 0; i < c.n; i++) {
        const age = c.time - c.creation[i];
        const life = c.life[i] || 1;
        const startT = lerp(startMin, startMax, particleRandom(c, i, salt)) * (startEndProportional ? life : 1);
        const endT = lerp(endMin, endMax, particleRandom(c, i, salt + 31)) * (startEndProportional ? life : 1);
        if (age < startT || age > endT) continue;
        for (let k = 0; k < comps; k++) {
          const rate = lerp(rateMin[k], rateMax[k], particleRandom(c, i, salt + 101 + k));
          const freq = lerp(freqMin[k], freqMax[k], particleRandom(c, i, salt + 211 + k));
          const t = proportional ? age / life : age;
          // a sine of the particle's time, which starts at the given phase; its rate is a change per second
          const wave = Math.sin(((t * freq * multiplier) + phase) * Math.PI) ;
          const base = init ? init.array[i * f.size + k] : f.array[i * f.size + k];
          void base;
          f.array[i * f.size + k] += wave * rate * c.dt * strength;
        }
      }
    },
  });
}
register(["Oscillate Scalar", "oscillate_scalar"], (a) => oscillator(a, false));
register(["Oscillate Vector", "oscillate_vector"], (a) => oscillator(a, true));

register("Noise Scalar", (a) => {
  const outField = a.int("output field"), min = a.num("output minimum"), max = a.num("output maximum"), scale = a.num("noise coordinate scale", 1);
  return fn(a, {
    operate(c) {
      const f = field(c, outField);
      if (!f) return;
      for (let i = 0; i < c.n; i++) {
        const s = noise4(c.xyz[i * 3] * scale, c.xyz[i * 3 + 1] * scale, c.xyz[i * 3 + 2] * scale, c.time) * 0.5 + 0.5;
        f.array[i * f.size] = lerp(min, max, clamp(s, 0, 1));
      }
    },
  });
});
register("Noise Vector", (a) => {
  const outField = a.int("output field"), min = a.vec("output minimum"), max = a.vec("output maximum"), scale = a.num("noise coordinate scale", 1);
  return fn(a, {
    operate(c) {
      const f = field(c, outField);
      if (!f) return;
      for (let i = 0; i < c.n; i++) for (let k = 0; k < f.size; k++) {
        const s = noise4(c.xyz[i * 3] * scale + k * 17.3, c.xyz[i * 3 + 1] * scale - k * 9.1, c.xyz[i * 3 + 2] * scale + k * 5.7, c.time) * 0.5 + 0.5;
        f.array[i * f.size + k] = lerp(min[k], max[k], clamp(s, 0, 1));
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// remap
function writeValue(c: Collection, i: number, id: number, value: number | Vec3, scaleInitial: boolean, add = false) {
  const f = field(c, id);
  if (!f) return;
  const ini = initialField(c, id);
  for (let k = 0; k < f.size; k++) {
    const v = typeof value === "number" ? value : value[k];
    const at = i * f.size + k;
    f.array[at] = add ? f.array[at] + v : scaleInitial && ini ? ini.array[at] * v : v;
  }
  if (id === 7 || id === 16) f.array[i] = clamp(f.array[i], 0, 1);
}

register("Remap Scalar", (a) => {
  const inField = a.int("input field"), outField = a.int("output field");
  const inMin = a.num("input minimum"), inMax = a.num("input maximum"), outMin = a.num("output minimum"), outMax = a.num("output maximum");
  return fn(a, {
    operate(c) {
      const src = field(c, inField);
      if (!src) return;
      for (let i = 0; i < c.n; i++) writeValue(c, i, outField, remapClamped(src.array[i * src.size], inMin, inMax, outMin, outMax), false);
    },
  });
});

function remapDistance(a: Attrs, vector: boolean) {
  const cp = a.int("control point"), outField = a.int("output field"), localCp = a.int("local space CP", -1);
  const dMin = a.num("distance minimum"), dMax = a.num("distance maximum");
  const outMinS = a.num("output minimum"), outMaxS = a.num("output maximum");
  const outMinV = a.vec("output minimum"), outMaxV = a.vec("output maximum");
  const scale = a.bool("output is scalar of initial random range"), only = a.bool("only active within specified distance");
  return fn(a, {
    operate(c) {
      const p = c.cps[cp].pos;
      for (let i = 0; i < c.n; i++) {
        const d = Math.hypot(c.xyz[i * 3] - p[0], c.xyz[i * 3 + 1] - p[1], c.xyz[i * 3 + 2] - p[2]);
        if (only && (d < Math.min(dMin, dMax) || d > Math.max(dMin, dMax))) continue;
        const t = clamp(remap(d, dMin, dMax, 0, 1), 0, 1);
        if (vector) {
          const v: Vec3 = [lerp(outMinV[0], outMaxV[0], t), lerp(outMinV[1], outMaxV[1], t), lerp(outMinV[2], outMaxV[2], t)];
          writeValue(c, i, outField, localCp >= 0 && outField === 0 ? c.cpRotate(localCp, v, v3) : v, scale);
        } else writeValue(c, i, outField, lerp(outMinS, outMaxS, t), scale);
      }
    },
  });
}
register("Remap Distance to Control Point to Scalar", (a) => remapDistance(a, false));
register("Remap Distance to Control Point to Vector", (a) => remapDistance(a, true));

register("Remap Distance Between Two Control Points to Scalar", (a) => {
  const c1 = a.int("starting control point"), c2 = a.int("ending control point"), outField = a.int("output field");
  const dMin = a.num("distance minimum"), dMax = a.num("distance maximum"), outMin = a.num("output minimum"), outMax = a.num("output maximum");
  const scale = a.bool("output is scalar of initial random range");
  return fn(a, {
    operate(c) {
      const p = c.cps[c1].pos, q = c.cps[c2].pos;
      const v = remapClamped(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), dMin, dMax, outMin, outMax);
      for (let i = 0; i < c.n; i++) writeValue(c, i, outField, v, scale);
    },
  });
});

register("Remap Dot Product to Scalar", (a) => {
  const c1 = a.int("first input control point"), c2 = a.int("second input control point"), useVel = a.bool("use particle velocity for first input");
  const inMin = a.num("input minimum (-1 to 1)", -1), inMax = a.num("input maximum (-1 to 1)", 1), outField = a.int("output field");
  const outMin = a.num("output minimum"), outMax = a.num("output maximum"), scale = a.bool("output is scalar of initial random range"), only = a.bool("only active within specified input range");
  return fn(a, {
    operate(c) {
      const second = c.cps[c2].forward;
      const first = c.cps[c1].forward;
      for (let i = 0; i < c.n; i++) {
        let d: number;
        if (useVel) {
          const vx = c.xyz[i * 3] - c.prev[i * 3], vy = c.xyz[i * 3 + 1] - c.prev[i * 3 + 1], vz = c.xyz[i * 3 + 2] - c.prev[i * 3 + 2];
          const l = Math.hypot(vx, vy, vz) || 1;
          d = (vx * second[0] + vy * second[1] + vz * second[2]) / l;
        } else d = first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
        if (only && (d < Math.min(inMin, inMax) || d > Math.max(inMin, inMax))) continue;
        writeValue(c, i, outField, remapClamped(d, inMin, inMax, outMin, outMax), scale);
      }
    },
  });
});

register("Remap CP Speed to CP", (a) => {
  const inCp = a.int("input control point"), outCp = a.int("output control point"), comp = a.int("Output field 0-2 X/Y/Z");
  const inMin = a.num("input minimum"), inMax = a.num("input maximum"), outMin = a.num("output minimum"), outMax = a.num("output maximum");
  let last: Vec3 | null = null;
  return fn(a, {
    operate(c) {
      const p = c.cps[inCp].pos;
      if (!last) last = [p[0], p[1], p[2]];
      const speed = Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) / Math.max(c.dt, 1e-6);
      last[0] = p[0]; last[1] = p[1]; last[2] = p[2];
      const v = remapClamped(speed, inMin, inMax, outMin, outMax);
      const out = [...c.cps[outCp].pos] as Vec3;
      out[clamp(comp, 0, 2)] = v;
      c.setCP(outCp, out);
    },
    restart() { last = null; },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// culling
register("Cull Random", (a) => {
  const start = a.num("Cull Start Time"), end = a.num("Cull End Time", 1), e = a.num("Cull Time Exponent", 1), pct = a.num("Cull Percentage");
  const salt = nextSalt();
  return fn(a, {
    operate(c) {
      for (let i = 0; i < c.n; i++) {
        const age = c.time - c.creation[i];
        const when = lerp(start, end, Math.pow(particleRandom(c, i, salt), e));
        if (age >= when && particleRandom(c, i, salt + 5) < pct * c.dt * 60) c.killParticle(i);
      }
    },
  });
});

register("Cull when crossing plane", (a) => {
  const cp = a.int("Control Point for point on plane"), offset = a.num("Cull plane offset"), normal = a.vec("Plane Normal", [1, 0, 0]);
  return fn(a, {
    operate(c) {
      const n: Vec3 = [normal[0], normal[1], normal[2]];
      normalize(n);
      // the plane is `offset` away from the control point along its normal; what is past it is culled
      const origin = c.cps[cp].pos;
      const d0 = n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2] + offset;
      for (let i = 0; i < c.n; i++) {
        const d = n[0] * c.xyz[i * 3] + n[1] * c.xyz[i * 3 + 1] + n[2] * c.xyz[i * 3 + 2];
        if (d > d0) c.killParticle(i);
      }
    },
  });
});

register("Cull relative to model", (a) => {
  const cp = a.int("control_point_number"), onlyBox = a.bool("use only bounding box"), outside = a.bool("cull outside instead of inside");
  return fn(a, {
    operate(c) {
      const boxes = c.world.boxes;
      if (!boxes.length || !c.cps[cp].object) return;
      for (let i = 0; i < c.n; i++) {
        let inside = false;
        for (const box of boxes) {
          const m = box.transform;
          const x = c.xyz[i * 3] - m[3], y = c.xyz[i * 3 + 1] - m[7], z = c.xyz[i * 3 + 2] - m[11];
          // the transform is a rotation plus an offset: the point in the box's own frame
          const lx = m[0] * x + m[4] * y + m[8] * z, ly = m[1] * x + m[5] * y + m[9] * z, lz = m[2] * x + m[6] * y + m[10] * z;
          if (lx >= box.mins[0] && lx <= box.maxs[0] && ly >= box.mins[1] && ly <= box.maxs[1] && lz >= box.mins[2] && lz <= box.maxs[2]) { inside = true; break; }
        }
        void onlyBox;
        if (outside ? !inside : inside) c.killParticle(i);
      }
    },
  });
});

// ----------------------------------------------------------------------------------------------------------------------------------------
// control points
register("Set Control Point Positions", (a) => {
  const base = a.int("Control Point to offset positions from"), world = a.bool("Set positions in world space");
  const set = ["First", "Second", "Third", "Fourth"].map((name) => ({
    cp: a.int(`${name} Control Point Number`), parent: a.int(`${name} Control Point Parent`), pos: a.vec(`${name} Control Point Location`),
  }));
  return fn(a, {
    operate(c) {
      for (const s of set) {
        const p: Vec3 = world ? [s.pos[0], s.pos[1], s.pos[2]] : c.cpTransform(base, s.pos, [0, 0, 0]);
        c.setCP(s.cp, p);
        if (s.parent) c.setCPParent(s.cp, s.parent);
      }
    },
  });
});

register("Set Control Point To Particles' Center", (a) => {
  const cp = a.int("Control Point Number to Set"), offset = a.vec("Center Offset");
  return fn(a, {
    operate(c) {
      if (!c.n) return;
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < c.n; i++) { x += c.xyz[i * 3]; y += c.xyz[i * 3 + 1]; z += c.xyz[i * 3 + 2]; }
      c.setCP(cp, [x / c.n + offset[0], y / c.n + offset[1], z / c.n + offset[2]]);
    },
  });
});

register("Set Control Point To Player", (a) => {
  const cp = a.int("Control Point Number"), offset = a.vec("Control Point Offset");
  return fn(a, {
    operate(c) {
      // the "player" is the character: control point 0
      const p = c.cpTransform(0, offset, [0, 0, 0]);
      c.setCP(cp, p);
    },
  });
});

register("Set child control points from particle positions", (a) => {
  const first0 = a.int("first particle to copy"), count = a.int("# of control points to set", 1), firstCp = a.int("First control point to set");
  const group = a.int("Group ID to affect");
  const orient = a.bool("Set cp orientation for particles"), density = a.bool("Set cp density for particles");
  const velocity = a.bool("Set cp velocity for particles"), radius = a.bool("Set cp radius for particles");
  return fn(a, {
    operate(c) {
      for (const child of c.children) {
        if (child.def.groupId !== group) continue;
        for (let k = 0; k < count; k++) {
          const i = first0 + k;
          const cp = firstCp + k;
          if (i < c.n) {
            child.setCP(cp, [c.xyz[i * 3], c.xyz[i * 3 + 1], c.xyz[i * 3 + 2]]);
            if (velocity) child.setCPVelocity(cp, [(c.xyz[i * 3] - c.prev[i * 3]) / c.dt, (c.xyz[i * 3 + 1] - c.prev[i * 3 + 1]) / c.dt, (c.xyz[i * 3 + 2] - c.prev[i * 3 + 2]) / c.dt]);
            if (radius) child.setCPRadius(cp, c.radius[i]);
            if (density) child.setCPDensity(cp, c.alpha[i]);
            void orient;
          } else if (density) child.setCPDensity(cp, 0);
        }
      }
    },
  });
});

register("Color Light From Control Point", (a) => fn(a, {})); // lighting of the particles' colour by lights: not simulated
