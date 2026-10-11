import { fn, register } from "./collection";
import type { Vec3 } from "./attrs";
import { normalize } from "./util";

/**
 * Force generators: they add to the acceleration of the particles (xyz per particle, units per second squared); the movement operator
 * integrates it. A force is scaled by its strength (its fade in and out).
 */
register("random force", (a) => {
  const min = a.vec("min force"), max = a.vec("max force");
  return fn(a, {
    force(c, accel, strength) {
      for (let i = 0; i < c.n; i++) {
        accel[i * 3] += c.rand(min[0], max[0]) * strength;
        accel[i * 3 + 1] += c.rand(min[1], max[1]) * strength;
        accel[i * 3 + 2] += c.rand(min[2], max[2]) * strength;
      }
    },
  });
});

register("Pull towards control point", (a) => {
  const cp = a.int("control point number"), power = a.num("falloff power"), amount = a.num("amount of force");
  return fn(a, {
    force(c, accel, strength) {
      const p = c.cps[cp].pos;
      for (let i = 0; i < c.n; i++) {
        const dx = p[0] - c.xyz[i * 3], dy = p[1] - c.xyz[i * 3 + 1], dz = p[2] - c.xyz[i * 3 + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        // the pull falls off with distance to the given power (0: the same everywhere)
        const f = (amount * strength * (power === 0 ? 1 : Math.pow(d, -power))) / d;
        accel[i * 3] += dx * f; accel[i * 3 + 1] += dy * f; accel[i * 3 + 2] += dz * f;
      }
    },
  });
});

register("twist around axis", (a) => {
  const local = a.bool("object local space axis 0/1"), axis = a.vec("twist axis", [0, 0, 1]), amount = a.num("amount of force");
  return fn(a, {
    force(c, accel, strength) {
      const ax: Vec3 = local ? c.cpRotate(0, axis, [0, 0, 0]) : [axis[0], axis[1], axis[2]];
      normalize(ax);
      const origin = c.cps[0].pos;
      for (let i = 0; i < c.n; i++) {
        const rx = c.xyz[i * 3] - origin[0], ry = c.xyz[i * 3 + 1] - origin[1], rz = c.xyz[i * 3 + 2] - origin[2];
        // around the axis: perpendicular to both the axis and the particle's offset from it
        let tx = ax[1] * rz - ax[2] * ry, ty = ax[2] * rx - ax[0] * rz, tz = ax[0] * ry - ax[1] * rx;
        const l = Math.hypot(tx, ty, tz);
        if (l < 1e-6) continue;
        tx /= l; ty /= l; tz /= l;
        accel[i * 3] += tx * amount * strength; accel[i * 3 + 1] += ty * amount * strength; accel[i * 3 + 2] += tz * amount * strength;
      }
    },
  });
});
