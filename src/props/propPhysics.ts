import * as THREE from "three";

/**
 * A small rigid-body world for the props of a scene in play mode: oriented boxes that fall, land on the floor, tip, slide, push each other and
 * are pushed by the player, by bullets and by explosions. It works in the viewer's own space (Y up, units of the game) and knows nothing
 * of characters or of the renderer: the viewer gives it boxes and moves the models to where it puts them.
 *
 * It is not VPhysics. A prop is the box of its model (the mesh's bounds, scaled), its mass is the one its .phy file gives, and contacts are
 * resolved with impulses at the corners, which is plenty for a barrel that rolls over or a crate that slides when it is shot.
 */

export const GRAVITY = 800;
const STEP = 1 / 120;
const MAX_STEPS = 4;
const FRICTION = 0.6;
const RESTITUTION = 0.25;
const SLEEP_SPEED = 10;
const SLEEP_SPIN = 0.3;
const SLEEP_TIME = 0.4;

const FIXED = Symbol("fixed");

export interface PropBodyInit {
  /** The middle of the box, and its orientation. */
  center: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Half the size of the box along its own axes. */
  half: THREE.Vector3;
  /** Kilograms; `Infinity` (or `fixed`) for a body that never moves. */
  mass: number;
  fixed?: boolean;
  /** Whatever the caller wants to find again (the model). */
  data?: unknown;
}

export class PropBody {
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly half: THREE.Vector3;
  readonly v = new THREE.Vector3();
  readonly w = new THREE.Vector3();
  readonly mass: number;
  readonly invMass: number;
  /** The inverse of the principal moments of inertia, along the box's axes. */
  readonly invInertia: THREE.Vector3;
  readonly fixed: boolean;
  readonly data: unknown;
  sleeping = false;
  rest = 0;
  /** Whether the body moved since the last time `consumeMoved` was asked. */
  moved = false;
  /** The radius of a sphere that holds the box. */
  readonly reach: number;
  constructor(init: PropBodyInit) {
    this.p = init.center.clone();
    this.q = init.quaternion.clone().normalize();
    this.half = init.half.clone().max(new THREE.Vector3(0.5, 0.5, 0.5));
    this.fixed = !!init.fixed || !Number.isFinite(init.mass);
    this.mass = this.fixed ? Infinity : Math.max(0.1, init.mass);
    this.invMass = this.fixed ? 0 : 1 / this.mass;
    const { x, y, z } = this.half;
    this.invInertia = this.fixed ? new THREE.Vector3() : new THREE.Vector3(3 / (this.mass * (y * y + z * z)), 3 / (this.mass * (x * x + z * z)), 3 / (this.mass * (x * x + y * y)));
    this.data = init.data;
    this.reach = this.half.length();
    void FIXED;
  }

  /** The eight corners in the world. */
  corners(out: THREE.Vector3[]): THREE.Vector3[] {
    let i = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      (out[i] ??= new THREE.Vector3()).set(sx * this.half.x, sy * this.half.y, sz * this.half.z).applyQuaternion(this.q).add(this.p);
      i++;
    }
    return out;
  }

  /** The highest point of the box. */
  top(): number {
    let y = -Infinity;
    for (const c of this.corners([])) y = Math.max(y, c.y);
    return y;
  }

  wake() {
    this.sleeping = false;
    this.rest = 0;
  }
}

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), E = new THREE.Vector3();
const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** The change of angular velocity an impulse `j` at offset `r` from the centre makes: invI_world * (r x j). */
function spinPerImpulse(body: PropBody, r: THREE.Vector3, j: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.crossVectors(r, j);
  Q.copy(body.q).invert();
  out.applyQuaternion(Q).multiply(body.invInertia).applyQuaternion(body.q);
  return out;
}

/** The velocity of the point at offset `r` of a body. */
const pointVelocity = (body: PropBody, r: THREE.Vector3, out: THREE.Vector3) => out.crossVectors(body.w, r).add(body.v);

/** The inverse mass an impulse along `n` at offset `r` meets: how little the body gives way. */
function effectiveInverseMass(body: PropBody, r: THREE.Vector3, n: THREE.Vector3): number {
  if (body.fixed) return 0;
  spinPerImpulse(body, r, n, E);
  return body.invMass + n.dot(D.crossVectors(E, r));
}

export class PropWorld {
  readonly bodies: PropBody[] = [];
  /** The height of the floor. */
  floor = 0;
  private remainder = 0;
  private readonly cornersA: THREE.Vector3[] = [];
  private readonly cornersB: THREE.Vector3[] = [];

  add(init: PropBodyInit): PropBody {
    const body = new PropBody(init);
    this.bodies.push(body);
    return body;
  }

  /** Gives a body an impulse (kg * units/s) at a point of the world, and wakes it. */
  impulse(body: PropBody, point: THREE.Vector3, j: THREE.Vector3) {
    if (body.fixed) return;
    body.wake();
    body.moved = true;
    body.v.addScaledVector(j, body.invMass);
    body.w.add(spinPerImpulse(body, A.subVectors(point, body.p), j, B));
  }

  /** Whether any body is awake (the world has something to do). */
  get awake(): boolean {
    return this.bodies.some((b) => !b.fixed && !b.sleeping);
  }

  step(dt: number) {
    this.remainder = Math.min(this.remainder + dt, STEP * MAX_STEPS);
    while (this.remainder >= STEP) {
      this.remainder -= STEP;
      this.substep(STEP);
    }
  }

  private substep(h: number) {
    for (const b of this.bodies) {
      // a sleeping body that something has thrown into wakes
      if (b.sleeping && !b.fixed && (b.v.lengthSq() > 64 || b.w.lengthSq() > 0.25)) b.wake();
      if (b.fixed || b.sleeping) continue;
      b.v.y -= GRAVITY * h;
      b.v.multiplyScalar(1 - 0.05 * h);
      b.w.multiplyScalar(1 - 0.35 * h);
      b.p.addScaledVector(b.v, h);
      const angle = b.w.length() * h;
      if (angle > 1e-9) b.q.premultiply(Q.setFromAxisAngle(A.copy(b.w).normalize(), angle)).normalize();
      b.moved = true;
    }
    // a few rounds, so that a box resting on its corners settles
    for (let pass = 0; pass < 4; pass++) {
      for (const b of this.bodies) if (!b.fixed && !b.sleeping) this.floorContacts(b, pass === 0);
      for (let i = 0; i < this.bodies.length; i++) {
        for (let k = i + 1; k < this.bodies.length; k++) this.boxContacts(this.bodies[i], this.bodies[k], pass === 0);
      }
    }
    for (const b of this.bodies) {
      if (b.fixed || b.sleeping) continue;
      if (b.v.length() < SLEEP_SPEED && b.w.length() < SLEEP_SPIN) {
        b.rest += h;
        if (b.rest > SLEEP_TIME) { b.sleeping = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); }
      } else b.rest = 0;
    }
  }

  /** The corners below the floor: pushed out, and their velocity into it taken away (with friction along it). */
  private floorContacts(b: PropBody, correct: boolean) {
    const corners = b.corners(this.cornersA);
    let deepest = 0, touching = 0;
    for (const c of corners) if (this.floor - c.y > 0) touching++;
    // the corners that touch share the work (taken one after the other each would throw the box off to its side)
    for (const c of corners) {
      const depth = this.floor - c.y;
      if (depth <= 0) continue;
      deepest = Math.max(deepest, depth);
      this.resolve(b, null, c, UP, depth, 1 / Math.max(touching, 1) * 1.6);
    }
    if (correct && deepest > 0.02) b.p.y += (deepest - 0.02) * 0.8;
  }

  /** Impulse at `point` along the normal `n` (pointing out of `other`, or up from the floor), then friction. */
  private resolve(a: PropBody, other: PropBody | null, point: THREE.Vector3, n: THREE.Vector3, depth: number, weight = 1) {
    const ra = new THREE.Vector3().subVectors(point, a.p);
    const rb = other ? new THREE.Vector3().subVectors(point, other.p) : null;
    const va = pointVelocity(a, ra, new THREE.Vector3());
    if (other && rb) va.sub(pointVelocity(other, rb, new THREE.Vector3()));
    const vn = va.dot(n);
    if (vn >= 0) return;
    const denom = effectiveInverseMass(a, ra, n) + (other && rb ? effectiveInverseMass(other, rb, n) : 0);
    if (denom <= 0) return;
    const e = vn < -80 ? RESTITUTION : 0;
    const jn = -(1 + e) * vn / denom * weight;
    const impulse = n.clone().multiplyScalar(jn);
    this.apply(a, ra, impulse);
    if (other && rb) this.apply(other, rb, impulse.clone().negate());
    // friction: the sliding velocity along the surface, taken away as far as the normal impulse allows
    const slide = va.clone().addScaledVector(n, -vn);
    const speed = slide.length();
    if (speed > 1e-6) {
      const t = slide.divideScalar(speed);
      const tDenom = effectiveInverseMass(a, ra, t) + (other && rb ? effectiveInverseMass(other, rb, t) : 0);
      if (tDenom > 0) {
        const jt = Math.min(speed / tDenom * weight, FRICTION * jn);
        const friction = t.multiplyScalar(-jt);
        this.apply(a, ra, friction);
        if (other && rb) this.apply(other, rb, friction.clone().negate());
      }
    }
    void depth;
  }

  private apply(body: PropBody, r: THREE.Vector3, j: THREE.Vector3) {
    if (body.fixed) return;
    body.v.addScaledVector(j, body.invMass);
    body.w.add(spinPerImpulse(body, r, j, new THREE.Vector3()));
  }

  /** Two boxes: found overlapping by the separating axis test, pushed apart along the axis of least overlap, with an impulse at the corners that went in. */
  private boxContacts(a: PropBody, b: PropBody, correct: boolean) {
    if ((a.fixed || a.sleeping) && (b.fixed || b.sleeping)) return;
    if (a.p.distanceTo(b.p) > a.reach + b.reach) return;
    const axesA = [new THREE.Vector3(1, 0, 0).applyQuaternion(a.q), new THREE.Vector3(0, 1, 0).applyQuaternion(a.q), new THREE.Vector3(0, 0, 1).applyQuaternion(a.q)];
    const axesB = [new THREE.Vector3(1, 0, 0).applyQuaternion(b.q), new THREE.Vector3(0, 1, 0).applyQuaternion(b.q), new THREE.Vector3(0, 0, 1).applyQuaternion(b.q)];
    const axes = [...axesA, ...axesB];
    for (const x of axesA) for (const y of axesB) {
      const c = new THREE.Vector3().crossVectors(x, y);
      if (c.lengthSq() > 1e-6) axes.push(c.normalize());
    }
    const offset = new THREE.Vector3().subVectors(b.p, a.p);
    const radius = (body: PropBody, axes3: THREE.Vector3[], axis: THREE.Vector3) => Math.abs(axes3[0].dot(axis)) * body.half.x + Math.abs(axes3[1].dot(axis)) * body.half.y + Math.abs(axes3[2].dot(axis)) * body.half.z;
    let best = Infinity;
    const normal = new THREE.Vector3();
    for (const axis of axes) {
      const overlap = radius(a, axesA, axis) + radius(b, axesB, axis) - Math.abs(offset.dot(axis));
      if (overlap <= 0) return;
      // a face axis of a box wins over a nearly equal edge axis: it is steadier
      if (overlap < best - 1e-4) { best = overlap; normal.copy(axis); }
    }
    if (normal.dot(offset) < 0) normal.negate();
    // the corners of each box that are inside the other (with a little room) are where they touch
    const inside = (body: PropBody, point: THREE.Vector3) => {
      const local = A.copy(point).sub(body.p).applyQuaternion(Q.copy(body.q).invert());
      return Math.abs(local.x) <= body.half.x + 0.3 && Math.abs(local.y) <= body.half.y + 0.3 && Math.abs(local.z) <= body.half.z + 0.3;
    };
    const contacts: THREE.Vector3[] = [];
    for (const c of a.corners(this.cornersA)) if (inside(b, c)) contacts.push(c.clone());
    for (const c of b.corners(this.cornersB)) if (inside(a, c)) contacts.push(c.clone());
    if (!contacts.length) contacts.push(a.p.clone().addScaledVector(offset, 0.5));
    for (const point of contacts) this.resolve(b, a, point, normal, best / contacts.length);
    if (a.sleeping && !b.sleeping && best > 0.5) a.wake();
    if (b.sleeping && !a.sleeping && best > 0.5) b.wake();
    if (correct) {
      const total = a.invMass + b.invMass;
      if (total > 0) {
        const push = Math.max(best - 0.02, 0) * 0.8;
        a.p.addScaledVector(normal, -push * a.invMass / total);
        b.p.addScaledVector(normal, push * b.invMass / total);
        a.moved ||= !a.fixed;
        b.moved ||= !b.fixed;
      }
    }
  }

  /** The first body a segment goes through: its distance along it, the point and the body. */
  raycast(start: THREE.Vector3, end: THREE.Vector3): { body: PropBody; point: THREE.Vector3; distance: number } | null {
    const length = start.distanceTo(end);
    if (length < 1e-6) return null;
    const ray = new THREE.Ray(start.clone(), end.clone().sub(start).divideScalar(length));
    let best: { body: PropBody; point: THREE.Vector3; distance: number } | null = null;
    const box = new THREE.Box3(), local = new THREE.Ray();
    for (const body of this.bodies) {
      box.min.copy(body.half).negate();
      box.max.copy(body.half);
      M.compose(body.p, body.q, new THREE.Vector3(1, 1, 1)).invert();
      local.copy(ray).applyMatrix4(M);
      const hit = local.intersectBox(box, new THREE.Vector3());
      if (!hit) continue;
      const point = hit.applyMatrix4(M.copy(M).invert());
      const distance = point.distanceTo(start);
      if (distance <= length + 1e-6 && (!best || distance < best.distance)) best = { body, point, distance };
    }
    return best;
  }

  /** The point of a box nearest to a point of the world. */
  nearestPoint(body: PropBody, point: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const local = out.copy(point).sub(body.p).applyQuaternion(Q.copy(body.q).invert());
    local.set(Math.min(Math.max(local.x, -body.half.x), body.half.x), Math.min(Math.max(local.y, -body.half.y), body.half.y), Math.min(Math.max(local.z, -body.half.z), body.half.z));
    return local.applyQuaternion(body.q).add(body.p);
  }

  /** An explosion: every body within `radius` of its box gets an impulse away from the middle that falls off with the distance. */
  blast(position: THREE.Vector3, radius: number, strength = 14000) {
    for (const body of this.bodies) {
      if (body.fixed) continue;
      const near = this.nearestPoint(body, position, new THREE.Vector3());
      const distance = near.distanceTo(position);
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      const direction = new THREE.Vector3().subVectors(body.p, position);
      if (direction.lengthSq() < 1e-6) direction.copy(UP);
      direction.normalize();
      // a little upward, as the engine's push is
      direction.y += 0.3;
      direction.normalize();
      this.impulse(body, near, direction.multiplyScalar(strength * falloff));
    }
  }

  /**
   * The player (a vertical capsule of three spheres) against the boxes: the position it is pushed to so that it does not stand inside one, and
   * the bodies it pushed (a light one gives way, a heavy one stops the player).
   */
  pushOut(position: THREE.Vector3, radius: number, height: number, velocity: THREE.Vector3, playerMass = 90): THREE.Vector3 {
    const out = position.clone();
    const heights = [radius, height / 2, height - radius];
    for (let pass = 0; pass < 3; pass++) {
      for (const body of this.bodies) {
        if (A.copy(body.p).sub(out).setY(0).length() > body.reach + radius + 2) continue;
        // above the box: it is stood on, not walked into
        if (out.y > body.top() - 2) continue;
        for (const h of heights) {
          C.set(out.x, out.y + h, out.z);
          const near = this.nearestPoint(body, C, new THREE.Vector3());
          const delta = new THREE.Vector3().subVectors(C, near);
          let distance = delta.length();
          if (distance >= radius) continue;
          // the push is sideways whatever the height of the touch
          delta.y = 0;
          if (delta.lengthSq() < 1e-8) delta.set(out.x - body.p.x, 0, out.z - body.p.z);
          if (delta.lengthSq() < 1e-8) delta.set(1, 0, 0);
          delta.normalize();
          distance = Math.max(distance, 0);
          const depth = radius - distance;
          const share = body.fixed ? 1 : body.mass / (body.mass + playerMass);
          out.addScaledVector(delta, depth * share);
          if (!body.fixed) {
            body.wake();
            body.moved = true;
            body.p.addScaledVector(delta, -depth * (1 - share));
            // what the player pushes with: its speed towards the box
            const towards = Math.max(0, -velocity.dot(delta));
            body.v.addScaledVector(delta, -Math.min(towards, 260) * (1 - share) * 0.6 - 4 * (1 - share));
          }
        }
      }
    }
    return out;
  }

  /** The bodies that moved since the last call (their models have to follow), and forgets that they did. */
  consumeMoved(): PropBody[] {
    const moved = this.bodies.filter((b) => b.moved);
    for (const b of moved) b.moved = false;
    return moved;
  }
}
