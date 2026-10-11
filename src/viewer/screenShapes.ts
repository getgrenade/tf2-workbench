/**
 * The shapes of the view tools (box, lasso, brush) as screen-space tests against a triangle: a triangle is picked when the shape touches it
 * anywhere, however big the triangle is on screen (so it works the same zoomed in and out). Coordinates are client pixels.
 */
export interface ScreenShape {
  hits(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean;
}

function pointInTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function pointSegmentDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by);
  const d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentSegmentDist2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(pointSegmentDist2(ax, ay, cx, cy, dx, dy), pointSegmentDist2(bx, by, cx, cy, dx, dy), pointSegmentDist2(cx, cy, ax, ay, bx, by), pointSegmentDist2(dx, dy, ax, ay, bx, by));
}

/** Whether the segment touches the rectangle (Liang-Barsky clipping). */
function segmentHitsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function boxShape(x0: number, y0: number, x1: number, y1: number): ScreenShape {
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  return {
    hits(ax, ay, bx, by, cx, cy) {
      if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x1 || Math.max(ay, by, cy) < y0 || Math.min(ay, by, cy) > y1) return false;
      if (inside(ax, ay) || inside(bx, by) || inside(cx, cy)) return true;
      if (pointInTriangle(x0, y0, ax, ay, bx, by, cx, cy)) return true; // a box inside one big triangle
      return segmentHitsRect(ax, ay, bx, by, x0, y0, x1, y1) || segmentHitsRect(bx, by, cx, cy, x0, y0, x1, y1) || segmentHitsRect(cx, cy, ax, ay, x0, y0, x1, y1);
    },
  };
}

/** The brush: a circle of `radius` moved along the line from one point to another. */
export function brushShape(fromX: number, fromY: number, toX: number, toY: number, radius: number): ScreenShape {
  const r2 = radius * radius;
  const minX = Math.min(fromX, toX) - radius, maxX = Math.max(fromX, toX) + radius;
  const minY = Math.min(fromY, toY) - radius, maxY = Math.max(fromY, toY) + radius;
  return {
    hits(ax, ay, bx, by, cx, cy) {
      if (Math.max(ax, bx, cx) < minX || Math.min(ax, bx, cx) > maxX || Math.max(ay, by, cy) < minY || Math.min(ay, by, cy) > maxY) return false;
      if (pointInTriangle(fromX, fromY, ax, ay, bx, by, cx, cy) || pointInTriangle(toX, toY, ax, ay, bx, by, cx, cy)) return true;
      return (
        segmentSegmentDist2(fromX, fromY, toX, toY, ax, ay, bx, by) <= r2 ||
        segmentSegmentDist2(fromX, fromY, toX, toY, bx, by, cx, cy) <= r2 ||
        segmentSegmentDist2(fromX, fromY, toX, toY, cx, cy, ax, ay) <= r2
      );
    },
  };
}

/** The lasso: the triangle is picked when a corner or its middle is inside the shape, or the shape starts inside the triangle. */
export function lassoShape(points: [number, number][]): ScreenShape {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const inside = (x: number, y: number) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    let in_ = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) in_ = !in_;
    }
    return in_;
  };
  return {
    hits(ax, ay, bx, by, cx, cy) {
      if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x1 || Math.max(ay, by, cy) < y0 || Math.min(ay, by, cy) > y1) return false;
      if (inside(ax, ay) || inside(bx, by) || inside(cx, cy) || inside((ax + bx + cx) / 3, (ay + by + cy) / 3)) return true;
      return points.length > 0 && pointInTriangle(points[0][0], points[0][1], ax, ay, bx, by, cx, cy);
    },
  };
}
