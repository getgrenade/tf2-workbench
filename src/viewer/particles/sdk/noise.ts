/**
 * Gradient noise for the particle operators that follow a noise field (Velocity Noise, Remap Noise to Scalar, Noise Scalar, Emit Noise...):
 * classic Perlin noise in 4D (three of space and one of time), -1 .. 1, smooth over about one unit of its coordinates.
 */
const PERM = (() => {
  // Ken Perlin's reference permutation
  const p = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
  return Uint8Array.from([...p, ...p]);
})();

// the 32 edge directions of a hypercube (every gradient has three non-zero components)
const GRAD4 = [
  [0, 1, 1, 1], [0, 1, 1, -1], [0, 1, -1, 1], [0, 1, -1, -1], [0, -1, 1, 1], [0, -1, 1, -1], [0, -1, -1, 1], [0, -1, -1, -1],
  [1, 0, 1, 1], [1, 0, 1, -1], [1, 0, -1, 1], [1, 0, -1, -1], [-1, 0, 1, 1], [-1, 0, 1, -1], [-1, 0, -1, 1], [-1, 0, -1, -1],
  [1, 1, 0, 1], [1, 1, 0, -1], [1, -1, 0, 1], [1, -1, 0, -1], [-1, 1, 0, 1], [-1, 1, 0, -1], [-1, -1, 0, 1], [-1, -1, 0, -1],
  [1, 1, 1, 0], [1, 1, -1, 0], [1, -1, 1, 0], [1, -1, -1, 0], [-1, 1, 1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0], [-1, -1, -1, 0],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);

function dot(h: number, x: number, y: number, z: number, w: number): number {
  const g = GRAD4[h & 31];
  return g[0] * x + g[1] * y + g[2] * z + g[3] * w;
}

/** Perlin noise at a point of 4D space, about -1 .. 1. */
export function noise4(x: number, y: number, z: number, w: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), W = Math.floor(w);
  x -= X; y -= Y; z -= Z; w -= W;
  const xi = X & 255, yi = Y & 255, zi = Z & 255, wi = W & 255;
  const u = fade(x), v = fade(y), s = fade(z), t = fade(w);
  const P = PERM;
  const corner = (dx: number, dy: number, dz: number, dw: number) =>
    dot(P[P[P[P[xi + dx] + yi + dy] + zi + dz] + wi + dw], x - dx, y - dy, z - dz, w - dw);
  const plane = (dw: number) =>
    lerp(s,
      lerp(v, lerp(u, corner(0, 0, 0, dw), corner(1, 0, 0, dw)), lerp(u, corner(0, 1, 0, dw), corner(1, 1, 0, dw))),
      lerp(v, lerp(u, corner(0, 0, 1, dw), corner(1, 0, 1, dw)), lerp(u, corner(0, 1, 1, dw), corner(1, 1, 1, dw))));
  return lerp(t, plane(0), plane(1)) * 0.9;
}
