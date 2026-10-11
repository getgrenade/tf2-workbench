import { fn, register } from "./collection";
import type { Vec3 } from "./attrs";
import { normalize } from "./util";

/**
 * Constraints: run by the movement operator after it moved the particles; they push particles back to where they may be (inside a distance,
 * above a plane, on the right side of the floor). A constraint changes the position and leaves the previous position, so what it takes away
 * from a particle is part of its velocity.
 */
register("Constrain distance to control point", (a) => {
  const cp = a.int("control point number"), min = a.num("minimum distance"), max = a.num("maximum distance", 100);
  const offset = a.vec("offset of center"), global = a.bool("global center point");
  return fn(a, {
    constrain(c) {
      const center: Vec3 = global ? [offset[0], offset[1], offset[2]] : c.cpTransform(cp, offset, [0, 0, 0]);
      let moved = false;
      for (let i = 0; i < c.n; i++) {
        const dx = c.xyz[i * 3] - center[0], dy = c.xyz[i * 3 + 1] - center[1], dz = c.xyz[i * 3 + 2] - center[2];
        const d = Math.hypot(dx, dy, dz);
        const clamped = d > max ? max : d < min ? min : d;
        if (clamped === d) continue;
        if (d < 1e-9) { c.xyz[i * 3] = center[0] + clamped; continue; }
        const s = clamped / d;
        c.xyz[i * 3] = center[0] + dx * s; c.xyz[i * 3 + 1] = center[1] + dy * s; c.xyz[i * 3 + 2] = center[2] + dz * s;
        moved = true;
      }
      return moved;
    },
  });
});

register("Prevent passing through a plane", (a) => {
  const cp = a.int("control point number"), point = a.vec("plane point"), normal = a.vec("plane normal", [0, 0, 1]);
  const globalOrigin = a.bool("global origin"), globalNormal = a.bool("global normal");
  return fn(a, {
    constrain(c) {
      const origin: Vec3 = globalOrigin ? [point[0], point[1], point[2]] : c.cpTransform(cp, point, [0, 0, 0]);
      const n: Vec3 = globalNormal ? [normal[0], normal[1], normal[2]] : c.cpRotate(cp, normal, [0, 0, 0]);
      normalize(n);
      let moved = false;
      for (let i = 0; i < c.n; i++) {
        const d = (c.xyz[i * 3] - origin[0]) * n[0] + (c.xyz[i * 3 + 1] - origin[1]) * n[1] + (c.xyz[i * 3 + 2] - origin[2]) * n[2];
        if (d >= 0) continue;
        c.xyz[i * 3] -= n[0] * d; c.xyz[i * 3 + 1] -= n[1] * d; c.xyz[i * 3 + 2] -= n[2] * d;
        moved = true;
      }
      return moved;
    },
  });
});

/**
 * Collision via traces. The only solid the viewer has is its floor (a plane at the height of the character's feet): a particle whose step
 * crosses it from above lands on it, bounces by the given amount and slides by the given fraction, or dies when asked to.
 */
register("Collision via traces", (a) => {
  const radiusScale = a.num("radius scale", 1), bounce = a.num("amount of bounce"), slide = a.num("amount of slide"), kill = a.bool("kill particle on collision");
  return fn(a, {
    constrain(c) {
      const floor = c.world.floor;
      if (floor === null) return false;
      let hit = false;
      for (let i = 0; i < c.n; i++) {
        const r = c.radius[i] * radiusScale;
        const z0 = c.prev[i * 3 + 2], z1 = c.xyz[i * 3 + 2];
        // the particle's lower edge crosses the floor going down
        if (!(z0 - r >= floor && z1 - r < floor) && !(z1 - r < floor && z0 - r < floor && z0 > z1)) continue;
        if (kill) { c.killParticle(i); continue; }
        const vx = c.xyz[i * 3] - c.prev[i * 3], vy = c.xyz[i * 3 + 1] - c.prev[i * 3 + 1], vz = c.xyz[i * 3 + 2] - c.prev[i * 3 + 2];
        const rest = floor + r;
        c.xyz[i * 3 + 2] = rest;
        // the new velocity: the part along the floor slides (friction takes `1 - slide`), the part into it bounces back
        const sx = vx * slide, sy = vy * slide, sz = Math.abs(vz) * bounce * 0.5;
        c.prev[i * 3] = c.xyz[i * 3] - sx; c.prev[i * 3 + 1] = c.xyz[i * 3 + 1] - sy; c.prev[i * 3 + 2] = rest - sz;
        hit = true;
      }
      return hit;
    },
  });
});
