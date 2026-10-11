/**
 * An animated GIF writer that keeps files small: one palette of 255 colours for the whole animation (median cut over a sample of every frame),
 * ordered dithering (it does not move from frame to frame, so still areas stay identical), and every frame stores only the box that changed
 * since the one before, with the unchanged pixels (and the ones that changed by less than `tolerance`) left transparent.
 */

export interface GifFrame {
  /** RGBA, top row first. */
  data: Uint8ClampedArray;
}

export interface GifOptions {
  fps: number;
  /** How far (in RGB distance) a pixel may drift from what is already shown before it is stored again. 0 stores every change. */
  tolerance?: number;
  /** Ordered dithering strength, 0 to 1. */
  dither?: number;
  /** Frames with this much alpha or less are transparent (a GIF has one bit of it). Without it every pixel is opaque. */
  transparent?: boolean;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BINS = 32768;
/** Index of the colour 5-5-5 bin of an RGB triple. */
const bin = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/** A palette of at most `max` colours (RGB triples) for the pixels of these frames, by median cut over a 5-5-5 histogram. */
export function buildPalette(frames: GifFrame[], max: number): Uint8Array {
  const counts = new Uint32Array(BINS);
  const total = frames.reduce((n, f) => n + f.data.length / 4, 0);
  const stride = Math.max(1, Math.floor(total / 200000));
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * stride) if (d[i + 3] > 127) counts[bin(d[i], d[i + 1], d[i + 2])]++;
  }
  interface Box { bins: number[]; n: number }
  const used: number[] = [];
  for (let i = 0; i < BINS; i++) if (counts[i]) used.push(i);
  if (!used.length) return new Uint8Array(3);
  const channel = (b: number, c: number) => (c === 0 ? b >> 10 : c === 1 ? (b >> 5) & 31 : b & 31);
  const boxes: Box[] = [{ bins: used, n: used.reduce((n, b) => n + counts[b], 0) }];
  while (boxes.length < max) {
    // split the box with the most pixels that can still be split, across its widest channel at the median pixel
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].bins.length > 1 && (pick < 0 || boxes[i].n > boxes[pick].n)) pick = i;
    if (pick < 0) break;
    const box = boxes[pick];
    let best = 0, span = -1;
    for (let c = 0; c < 3; c++) {
      let lo = 31, hi = 0;
      for (const b of box.bins) { const v = channel(b, c); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > span) { span = hi - lo; best = c; }
    }
    box.bins.sort((a, b) => channel(a, best) - channel(b, best));
    let acc = 0, cut = 0;
    for (; cut < box.bins.length - 2; cut++) { acc += counts[box.bins[cut]]; if (acc * 2 >= box.n) break; }
    const left = box.bins.slice(0, cut + 1), right = box.bins.slice(cut + 1);
    const sum = (list: number[]) => list.reduce((n, b) => n + counts[b], 0);
    boxes.splice(pick, 1, { bins: left, n: sum(left) }, { bins: right, n: sum(right) });
  }
  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0;
    for (const bn of box.bins) { const w = counts[bn]; r += (bn >> 10) * w; g += ((bn >> 5) & 31) * w; b += (bn & 31) * w; }
    palette[i * 3] = Math.min(255, Math.round((r / box.n) * 8 + 4));
    palette[i * 3 + 1] = Math.min(255, Math.round((g / box.n) * 8 + 4));
    palette[i * 3 + 2] = Math.min(255, Math.round((b / box.n) * 8 + 4));
  });
  return palette;
}

/** Remembers, for each 5-5-5 bin, the palette entry nearest to it. */
class Nearest {
  private readonly table = new Int16Array(BINS).fill(-1);
  private readonly palette: Uint8Array;
  constructor(palette: Uint8Array) { this.palette = palette; }
  at(r: number, g: number, b: number): number {
    const key = bin(r, g, b);
    let hit = this.table[key];
    if (hit >= 0) return hit;
    const cr = (r & 0xf8) + 4, cg = (g & 0xf8) + 4, cb = (b & 0xf8) + 4;
    let best = Infinity;
    for (let i = 0; i < this.palette.length; i += 3) {
      const dr = this.palette[i] - cr, dg = this.palette[i + 1] - cg, db = this.palette[i + 2] - cb;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < best) { best = d; hit = i / 3; }
    }
    this.table[key] = hit;
    return hit;
  }
}

/** GIF's variable-width LZW. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1;
  const out: number[] = [];
  let bits = 0, bitCount = 0;
  const emit = (code: number, width: number) => {
    bits |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) { out.push(bits & 255); bits >>>= 8; bitCount -= 8; }
  };
  let width = minCodeSize + 1;
  let next = end + 1;
  let table = new Map<number, number>();
  emit(clear, width);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix, width);
    if (next < 4096) {
      table.set(key, next++);
      if (next > (1 << width) && width < 12) width++;
    } else {
      emit(clear, width);
      table = new Map();
      next = end + 1;
      width = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix, width);
  emit(end, width);
  if (bitCount > 0) out.push(bits & 255);
  return Uint8Array.from(out);
}

/** Writes the animation. Frames are RGBA at `width` x `height`; the frame rate sets the delays (in hundredths of a second, with the rounding carried over). */
export function encodeGif(frames: GifFrame[], width: number, height: number, o: GifOptions): Uint8Array {
  if (!frames.length) throw new Error("no frames");
  const transparent = o.transparent === true;
  const tolerance = o.tolerance ?? 8;
  const dither = o.dither ?? 0.4;
  // the last palette entry is kept for "transparent" (unchanged pixels, and the clear background of a transparent picture)
  const colours = buildPalette(frames, 255);
  const TRANS = 255;
  const palette = new Uint8Array(256 * 3);
  palette.set(colours);
  const nearest = new Nearest(colours);
  const chunks: Uint8Array[] = [];
  const push = (...bytes: number[]) => chunks.push(Uint8Array.from(bytes));
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16(width), ...u16(height), 0xf7, 0, 0);
  chunks.push(palette);
  // loops for ever
  push(0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);

  const pixels = width * height;
  /** What the viewer of the file sees after the frames written so far (palette index, TRANS before the first). */
  let shown: Uint8Array | null = null;
  const reach = dither * 24;
  let clock = 0, written = 0;
  for (let n = 0; n < frames.length; n++) {
    const src = frames[n].data;
    const index = new Uint8Array(pixels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x, s = p * 4;
        if (transparent && src[s + 3] <= 127) { index[p] = TRANS; continue; }
        const t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * reach;
        index[p] = nearest.at(clamp8(src[s] + t), clamp8(src[s + 1] + t), clamp8(src[s + 2] + t));
      }
    }
    // the box that differs from what is shown; pixels that stay (or are close enough) are written as transparent
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    const out = new Uint8Array(pixels);
    const tol2 = tolerance * tolerance * 3;
    const prev = transparent ? null : shown;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const v = index[p];
        if (prev) {
          const was = prev[p];
          if (v === was || close(colours, v, was, tol2)) { out[p] = TRANS; index[p] = was; continue; }
        }
        out[p] = v;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; } // nothing changed: a one pixel frame holds the time
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const box = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) box.set(out.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + w), y * w);
    shown = index;
    // delay in hundredths: cumulative rounding keeps the total time right
    clock += 100 / o.fps;
    const delay = Math.max(2, Math.round(clock) - written);
    written += delay;
    // disposal 1 (leave the frame in place) for the changed-box frames; a transparent picture is drawn afresh each time (disposal 2, whole frame)
    if (transparent) { x0 = y0 = 0; }
    push(0x21, 0xf9, 4, (transparent ? 2 : 1) << 2 | 1, ...u16(delay), TRANS, 0);
    const drawW = transparent ? width : w, drawH = transparent ? height : h;
    const body = transparent ? index : box;
    push(0x2c, ...u16(x0), ...u16(y0), ...u16(drawW), ...u16(drawH), 0);
    push(8);
    const data = lzwEncode(body, 8);
    for (let i = 0; i < data.length; i += 255) {
      const part = data.subarray(i, i + 255);
      push(part.length);
      chunks.push(part);
    }
    push(0);
  }
  push(0x3b);
  const size = chunks.reduce((s, c) => s + c.length, 0);
  const file = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { file.set(c, at); at += c.length; }
  return file;
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
function close(p: Uint8Array, a: number, b: number, tol2: number): boolean {
  if (tol2 <= 0) return false;
  const dr = p[a * 3] - p[b * 3], dg = p[a * 3 + 1] - p[b * 3 + 1], db = p[a * 3 + 2] - p[b * 3 + 2];
  return dr * dr + dg * dg + db * db <= tol2;
}
