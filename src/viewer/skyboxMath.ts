/**
 * Skyboxes of the game: `materials/skybox/<name>{ft,bk,lf,rt,up,dn}.vmt`, six pictures of the sky seen from inside a box around the camera
 * (the `sky` shader draws them at infinity, so they turn with the view and never move with it). The shader multiplies the texture by the
 * material colour (1) and puts the VMT's `$basetexturetransform` on the coordinates of each face; the textures of most skies are cut off
 * at the horizon and are stretched twice as tall by that transform, with the last row repeating below (a clamped texture).
 *
 * This file is the geometry: which direction each face is in, where a direction hits a face, and how the six faces become the
 * cube texture of three.js. Directions are Source's (x forward, y left, z up) unless it says viewer.
 */

export type SkyFace = "ft" | "bk" | "lf" | "rt" | "up" | "dn";
export const SKY_FACES: readonly SkyFace[] = ["ft", "bk", "lf", "rt", "up", "dn"];

type V3 = readonly [number, number, number];

/**
 * The faces as seen from inside the box: the direction of the face, and where the right and the top of its picture point. The
 * pictures fit each other like this (the edges of the faces of a sky with distinct sides match exactly): the right edge of ft meets the
 * left edge of lf, lf meets bk, bk meets rt and rt meets ft; the top of up is next to lf, its right to ft, its bottom to rt and its left to bk.
 */
const FRAMES: Record<SkyFace, { n: V3; right: V3; up: V3 }> = {
  ft: { n: [-1, 0, 0], right: [0, 1, 0], up: [0, 0, 1] },
  lf: { n: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  bk: { n: [1, 0, 0], right: [0, -1, 0], up: [0, 0, 1] },
  rt: { n: [0, -1, 0], right: [-1, 0, 0], up: [0, 0, 1] },
  up: { n: [0, 0, 1], right: [-1, 0, 0], up: [0, 1, 0] },
  dn: { n: [0, 0, -1], right: [-1, 0, 0], up: [0, -1, 0] },
};

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The face a direction looks at, and where on its picture (u right, v down, both 0..1). */
export function skyLookup(d: V3): { face: SkyFace; u: number; v: number } {
  const [x, y, z] = d, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const face: SkyFace = ax >= ay && ax >= az ? (x > 0 ? "bk" : "ft") : ay >= az ? (y > 0 ? "lf" : "rt") : z > 0 ? "up" : "dn";
  const f = FRAMES[face];
  const m = Math.max(Math.abs(dot(d, f.n)), 1e-12);
  return { face, u: 0.5 + 0.5 * dot(d, f.right) / m, v: 0.5 - 0.5 * dot(d, f.up) / m };
}

/** The direction (not normalised) of a point of a face's picture; the other way round from `skyLookup`. */
export function skyDirection(face: SkyFace, u: number, v: number): [number, number, number] {
  const f = FRAMES[face], r = 2 * u - 1, t = 1 - 2 * v;
  return [f.n[0] + f.right[0] * r + f.up[0] * t, f.n[1] + f.right[1] * r + f.up[1] * t, f.n[2] + f.right[2] * r + f.up[2] * t];
}

/** A VMT texture transform: `center 0 0 scale 1 2 rotate 0 translate 0 0`. */
export interface TextureTransform {
  center: [number, number];
  scale: [number, number];
  rotate: number;
  translate: [number, number];
}

export const IDENTITY_TRANSFORM: TextureTransform = { center: [0.5, 0.5], scale: [1, 1], rotate: 0, translate: [0, 0] };

export function parseTextureTransform(value: string | undefined): TextureTransform {
  const t: TextureTransform = { center: [0.5, 0.5], scale: [1, 1], rotate: 0, translate: [0, 0] };
  if (!value) return t;
  const words = value.trim().split(/\s+/);
  const num = (i: number) => { const n = Number(words[i]); return Number.isFinite(n) ? n : 0; };
  for (let i = 0; i < words.length; i++) {
    const key = words[i].toLowerCase();
    if (key === "center") { t.center = [num(i + 1), num(i + 2)]; i += 2; }
    else if (key === "scale") { t.scale = [num(i + 1), num(i + 2)]; i += 2; }
    else if (key === "rotate") { t.rotate = num(i + 1); i += 1; }
    else if (key === "translate") { t.translate = [num(i + 1), num(i + 2)]; i += 2; }
  }
  return t;
}

/** The coordinates a transform gives a point: moved to the centre, scaled, turned, moved back and then translated. */
export function applyTransform(t: TextureTransform, u: number, v: number): [number, number] {
  const x = (u - t.center[0]) * t.scale[0], y = (v - t.center[1]) * t.scale[1];
  const a = t.rotate * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s + t.center[0] + t.translate[0], x * s + y * c + t.center[1] + t.translate[1]];
}

/** The picture of a face: its pixels (RGBA), the transform of its material and whether the texture is clamped on each side (else it repeats). */
export interface SkyPicture {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
  transform: TextureTransform;
  clampS: boolean;
  clampT: boolean;
}

/** The order of the faces of a cube texture in three.js: +x, -x, +y, -y, +z, -z (of the viewer, which is y up). */
const CUBE_DIRECTIONS: readonly V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * The direction (of the viewer: x to the side, y up, z forward) that a pixel of a face of a three.js cube texture shows: the faces are laid
 * out as in OpenGL, and three.js turns the x of a cube texture that is not a render target round before it looks.
 * `s` and `t` run over the picture from its left and its top, 0..1.
 */
export function cubeFaceDirection(index: number, s: number, t: number): [number, number, number] {
  const sc = 2 * s - 1, tc = 2 * t - 1;
  const d: [number, number, number] =
    index === 0 ? [1, -tc, -sc] : index === 1 ? [-1, -tc, sc] : index === 2 ? [sc, 1, tc] : index === 3 ? [sc, -1, -tc] : index === 4 ? [sc, -tc, 1] : [-sc, -tc, -1];
  return [-d[0], d[1], d[2]];
}

/** A direction of the viewer (x side, y up, z forward) in Source's (x forward, y left, z up). */
export const viewerToSource = (v: V3): [number, number, number] => [v[2], v[0], v[1]];

/** The colour of a picture at a point of its face (0..1), bilinear; the result is written to `out` as 0..255. */
function sample(p: SkyPicture, u: number, v: number, out: number[]) {
  const [tu, tv] = applyTransform(p.transform, u, v);
  const x = tu * p.width - 0.5, y = tv * p.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const wrap = (i: number, n: number, clamp: boolean) => (clamp ? Math.min(n - 1, Math.max(0, i)) : ((i % n) + n) % n);
  const xa = wrap(x0, p.width, p.clampS), xb = wrap(x0 + 1, p.width, p.clampS), ya = wrap(y0, p.height, p.clampT), yb = wrap(y0 + 1, p.height, p.clampT);
  const px = p.rgba;
  const i00 = (ya * p.width + xa) * 4, i10 = (ya * p.width + xb) * 4, i01 = (yb * p.width + xa) * 4, i11 = (yb * p.width + xb) * 4;
  for (let c = 0; c < 3; c++) out[c] = (px[i00 + c] * (1 - fx) + px[i10 + c] * fx) * (1 - fy) + (px[i01 + c] * (1 - fx) + px[i11 + c] * fx) * fy;
}

/** The six pictures of a cube texture of three.js (RGBA, `size` pixels square), looked up from the faces of a sky. */
export function buildCubeFaces(pictures: Record<SkyFace, SkyPicture>, size: number): Uint8ClampedArray<ArrayBuffer>[] {
  return CUBE_DIRECTIONS.map((_, index) => buildCubeFace(pictures, size, index));
}

export function buildCubeFace(pictures: Record<SkyFace, SkyPicture>, size: number, index: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hit = skyLookup(viewerToSource(cubeFaceDirection(index, (x + 0.5) / size, (y + 0.5) / size)));
      sample(pictures[hit.face], hit.u, hit.v, rgb);
      const i = (y * size + x) * 4;
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = 255;
    }
  }
  return out;
}
