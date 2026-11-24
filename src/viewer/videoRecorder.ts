import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import { encodeGif, type GifFrame } from "./gif";
import type { Viewer } from "./viewer";

/** "png" is a numbered sequence of PNG pictures, one per frame. */
export type VideoFormat = "mp4" | "webm" | "gif" | "png";
/** "play": recorded in real time while the character is steered in play mode (from when play mode starts to when it ends). */
export type VideoSource = "live" | "turntable" | "play";

export interface VideoOptions {
  source: VideoSource;
  format: VideoFormat;
  /** Size relative to the view (0.25 to 1: a video is never drawn larger than the view). */
  scale: number;
  fps: number;
  seconds: number;
  /** Turntable: degrees turned in `seconds` (negative turns the other way). The last frame stops short of the first, so a full turn loops. */
  turn: number;
  /** GIF and PNG sequence: the background and the ground plane are left out (a GIF has one bit of alpha, so its edges are hard). A shot through a camera follows that camera's Capture background setting. */
  transparent: boolean;
  /** GIF: made to fit in 2 MB (the Steam Workshop's limit): plainer, then smaller, as far as it must. */
  fit2mb?: boolean;
}

export const VIDEO_LIMITS = { seconds: [1, 60], turn: [-3600, 3600], scales: [1, 0.75, 0.5, 0.33, 0.25] } as const;
export const VIDEO_FPS: Record<VideoFormat, number[]> = { mp4: [24, 30, 60], webm: [24, 30, 60], gif: [10, 15, 20, 25], png: [24, 30, 60] };
/** The formats that can leave the background out (video codecs here have no alpha). */
export const canBeTransparent = (format: VideoFormat) => format === "gif" || format === "png";

export interface VideoProgress {
  phase: "rendering" | "encoding";
  done: number;
  total: number;
}

/** The size, in pixels, a video of the view at this scale has (even, as video codecs ask). */
export function videoSize(viewWidth: number, viewHeight: number, scale: number): { w: number; h: number } {
  const s = Math.min(1, scale);
  return { w: Math.max(2, Math.round(viewWidth * s) & ~1), h: Math.max(2, Math.round(viewHeight * s) & ~1) };
}

/** What "fit in 2 MB" fits a GIF in (the Steam Workshop's limit). */
export const GIF_FIT_BYTES = 2_000_000;

/** A GIF keeps every picture in memory and is made for sharing: its longest side stops at 720 pixels. */
export const GIF_MAX_SIDE = 720;
export function effectiveScale(base: { w: number; h: number }, o: Pick<VideoOptions, "format" | "scale">): number {
  const s = Math.min(1, o.scale);
  return o.format === "gif" ? Math.min(s, GIF_MAX_SIDE / Math.max(base.w, base.h)) : s;
}

export function videoSupport(): { codecs: boolean } {
  return { codecs: typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined" };
}

/** The first codec configuration the machine can encode for this size, or null. */
async function pickCodec(format: "mp4" | "webm", w: number, h: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  const codecs = format === "mp4" ? ["avc1.640033", "avc1.4d0033", "avc1.64002a", "avc1.42003e"] : ["vp09.00.40.08", "vp09.00.10.08", "vp8"];
  for (const codec of codecs) {
    const config: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: fps, ...(format === "mp4" ? { avc: { format: "avc" as const } } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* the next one */ }
  }
  return null;
}

/**
 * A slideshow of still pictures, each held for `hold` seconds (a paint animation): pictures are handed in one at a time (a video is
 * encoded as they come, a PNG sequence written as they come; a GIF keeps them until it is made), then `finish` gives the file.
 * Every picture is `w` × `h` (even, as video codecs ask). A GIF with `maxBytes` is made smaller until it fits (see fitGif); `made` then
 * says what it came to.
 */
export async function createStillsWriter(format: "gif" | "mp4" | "png", w: number, h: number, hold: number, writeFrame?: (index: number, png: Uint8Array) => Promise<void>,
  o: { maxBytes?: number; say?: (text: string) => void } = {}) {
  const made = { width: w, height: h, note: "" };
  const gif: GifFrame[] = [];
  let encoder: VideoEncoder | null = null;
  let mp4: Mp4Muxer<Mp4Target> | null = null;
  let failure: unknown = null;
  // (a video holds each picture as repeated frames: every player shows that, whatever it makes of long frames)
  const fps = 10, per = Math.max(1, Math.round(hold * fps));
  let frames = 0, count = 0;
  if (format === "mp4") {
    if (!videoSupport().codecs) throw new Error("This system cannot encode video here: use GIF or a PNG sequence.");
    const config = await pickCodec("mp4", w, h, fps, Math.round(w * h * fps * 0.14));
    if (!config) throw new Error(`This system cannot encode H.264 MP4 at ${w}×${h}: try the half size.`);
    mp4 = new Mp4Muxer({ target: new Mp4Target(), video: { codec: "avc", width: w, height: h, frameRate: fps }, fastStart: "in-memory" });
    encoder = new VideoEncoder({ output: (chunk, meta) => mp4!.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
    encoder.configure(config);
  }
  return {
    async add(canvas: HTMLCanvasElement) {
      if (failure) throw failure;
      if (encoder) {
        for (let k = 0; k < per; k++) {
          while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
          const frame = new VideoFrame(canvas, { timestamp: Math.round(frames * 1e6 / fps), duration: Math.round(1e6 / fps) });
          encoder.encode(frame, { keyFrame: k === 0 });
          frame.close();
          frames++;
        }
      } else if (format === "png") {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error(`Could not make picture ${count + 1} into a PNG`);
        await writeFrame!(count, new Uint8Array(await blob.arrayBuffer()));
      } else gif.push({ data: canvas.getContext("2d")!.getImageData(0, 0, w, h).data });
      count++;
    },
    async finish(): Promise<Uint8Array> {
      if (format === "gif") {
        const fit = fitGif(gif, w, h, 1 / hold, o.maxBytes ?? Infinity, o.say);
        Object.assign(made, fit, { note: fit.note });
        return fit.bytes;
      }
      if (format === "png") return new Uint8Array(0);
      await encoder!.flush();
      if (failure) throw failure;
      encoder!.close();
      mp4!.finalize();
      return new Uint8Array(mp4!.target.buffer);
    },
    close() { try { if (encoder && encoder.state !== "closed") encoder.close(); } catch { /* closed */ } },
    /** What the file came to (a GIF fitted to `maxBytes` may be smaller, or plainer, than asked). */
    made,
  };
}

/**
 * A GIF of these frames no larger than `maxBytes`: first as good as it gets, then, while too large, plainer (less dithering, more
 * tolerance for what stays from frame to frame, fewer colours), then smaller (scaled down by about as much as it is over). What it
 * gave up is in `note`.
 */
export function fitGif(frames: GifFrame[], w: number, h: number, fps: number, maxBytes: number, say?: (text: string) => void, transparent = false): { bytes: Uint8Array; width: number; height: number; note: string } {
  const tries = [
    { dither: 0.6, tolerance: 8, colours: 255, note: "" },
    { dither: 0.3, tolerance: 12, colours: 255, note: "less dithering" },
    { dither: 0, tolerance: 16, colours: 192, note: "no dithering, 192 colours" },
    { dither: 0, tolerance: 18, colours: 128, note: "no dithering, 128 colours" },
  ];
  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
  let bytes: Uint8Array = new Uint8Array(0);
  for (const t of tries) {
    bytes = encodeGif(frames, w, h, { fps, paletteEach: true, dither: t.dither, tolerance: t.tolerance, colours: t.colours, transparent });
    if (bytes.length <= maxBytes) return { bytes, width: w, height: h, note: t.note };
    say?.(`GIF: ${mb(bytes.length)}, over ${mb(maxBytes)}; making it smaller…`);
  }
  // then smaller: the size of a GIF goes about with its area
  const last = tries[tries.length - 1];
  let k = 1;
  for (let i = 0; i < 8; i++) {
    k *= Math.max(0.5, Math.min(0.95, Math.sqrt(maxBytes / bytes.length) * 0.97));
    const sw = Math.max(2, Math.round(w * k)), sh = Math.max(2, Math.round(h * k));
    const small = frames.map((f) => ({ data: shrinkFrame(f.data, w, h, sw, sh) }));
    bytes = encodeGif(small, sw, sh, { fps, paletteEach: true, dither: last.dither, tolerance: last.tolerance, colours: last.colours, transparent });
    if (bytes.length <= maxBytes || sw < 160) return { bytes, width: sw, height: sh, note: `${last.note}, ${sw} × ${sh}` };
    say?.(`GIF: ${mb(bytes.length)} at ${sw} × ${sh}; making it smaller…`);
  }
  return { bytes, width: w, height: h, note: "could not fit" };
}

/** RGBA pixels of one size, smoothly scaled to another. */
function shrinkFrame(data: Uint8ClampedArray, w: number, h: number, sw: number, sh: number): Uint8ClampedArray {
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  const dst = document.createElement("canvas");
  dst.width = sw;
  dst.height = sh;
  const ctx = dst.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh).data;
}

/**
 * Renders the scene frame by frame (the scene is moved on by exactly one frame's time between two pictures, so the result is smooth however
 * long the pictures take) and returns the file. A turntable turns the current camera round the vertical axis through its focus.
 * A PNG sequence hands each frame to `writeFrame` as it is drawn (nothing is kept) and returns no bytes.
 * Throws `Cancelled` when `signal` aborts.
 */
export async function recordVideo(v: Viewer, o: VideoOptions, onProgress: (p: VideoProgress) => void, signal: AbortSignal,
  writeFrame?: (index: number, png: Uint8Array) => Promise<void>, stopWhen?: () => boolean, say?: (text: string) => void): Promise<{ bytes: Uint8Array; width: number; height: number; frames: number; note?: string }> {
  if (o.format === "png" && !writeFrame) throw new Error("A PNG sequence needs somewhere to write its frames");
  let frames = Math.max(1, Math.round(o.seconds * o.fps));
  const scale = effectiveScale(v.captureBaseSize(), o);
  const dt = 1 / o.fps;
  const center = o.source === "turntable" ? v.turntableCenter() : null;
  const gif: GifFrame[] = [];
  let encoder: VideoEncoder | null = null;
  let mp4: Mp4Muxer<Mp4Target> | null = null;
  let webm: WebmMuxer<WebmTarget> | null = null;
  let failure: unknown = null;
  let width = 0, height = 0;
  let clock = performance.now();
  // play mode is recorded as it happens: the live loop runs (the player steers), and each picture is what the view shows at its time
  const live = o.source === "play";
  const t0 = performance.now();
  let written = 0;
  if (!live) v.offline = true;
  try {
    while (written < frames) {
      if (signal.aborted) throw new Error("Cancelled");
      if (live) {
        // (the next frame's time, waited for on the view's own frames)
        while (performance.now() - t0 < written * dt * 1000) await new Promise((r) => requestAnimationFrame(r));
        if (written > 0 && stopWhen?.()) break;
      } else {
        // (the first picture is the scene as it is now)
        clock += dt * 1000;
        v.stepFrame(clock, written === 0 ? 0 : dt);
      }
      const i = written;
      const shot = await v.capture(scale, o.transparent && canBeTransparent(o.format), {
        canvas: true,
        even: true,
        scaleSize: scale,
        ...(center ? { orbit: { angle: (o.turn * Math.PI / 180) * (i / frames), center } } : {}),
      });
      const canvas = shot.canvas!;
      // live: a picture that took longer than a frame stands for the frames it missed (the video keeps the real speed)
      const upTo = live ? Math.min(frames, Math.max(i + 1, Math.floor((performance.now() - t0) / (dt * 1000)))) : i + 1;
      if (i === 0) {
        width = shot.width;
        height = shot.height;
        if (o.format === "mp4" || o.format === "webm") {
          if (!videoSupport().codecs) throw new Error("This system cannot encode video here: use GIF.");
          const bitrate = Math.round(width * height * o.fps * 0.14);
          const config = await pickCodec(o.format, width, height, o.fps, bitrate);
          if (!config) throw new Error(`This system cannot encode ${o.format === "mp4" ? "H.264 MP4" : "WebM"} at ${width}×${height}${o.format === "mp4" ? ": try WebM or a smaller size" : ""}.`);
          if (o.format === "mp4") {
            mp4 = new Mp4Muxer({ target: new Mp4Target(), video: { codec: "avc", width, height, frameRate: o.fps }, fastStart: "in-memory" });
          } else {
            webm = new WebmMuxer({ target: new WebmTarget(), video: { codec: config.codec.startsWith("vp8") ? "V_VP8" : "V_VP9", width, height, frameRate: o.fps } });
          }
          encoder = new VideoEncoder({
            output: (chunk, meta) => { (mp4 ?? webm)!.addVideoChunk(chunk, meta); },
            error: (e) => { failure = e; },
          });
          encoder.configure(config);
        }
      }
      if (failure) throw failure;
      let png: Uint8Array | null = null, pixels: Uint8ClampedArray | null = null;
      for (let k = i; k < upTo; k++) {
        if (encoder) {
          // (keeps the encoder from falling behind: its queue holds whole pictures)
          while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
          const frame = new VideoFrame(canvas, { timestamp: Math.round(k * 1e6 / o.fps), duration: Math.round(1e6 / o.fps) });
          encoder.encode(frame, { keyFrame: k % Math.max(1, o.fps * 2) === 0 });
          frame.close();
        } else if (o.format === "png") {
          if (!png) {
            const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
            if (!blob) throw new Error(`Could not make frame ${k + 1} into a PNG`);
            png = new Uint8Array(await blob.arrayBuffer());
          }
          await writeFrame!(k, png);
        } else {
          pixels ??= canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
          gif.push({ data: pixels });
        }
      }
      written = upTo;
      onProgress({ phase: "rendering", done: written, total: frames });
      // lets the interface breathe between pictures
      if (!live) await new Promise((r) => setTimeout(r, 0));
    }
    frames = written;
    if (o.format === "gif") {
      onProgress({ phase: "encoding", done: 0, total: 1 });
      await new Promise((r) => setTimeout(r, 20));
      const bytes = encodeGif(gif, width, height, { fps: o.fps, transparent: o.transparent });
      // over 2 MB with the toggle on: plainer, then smaller, until it fits (what it gave up is in the note)
      if (o.fit2mb && bytes.length > GIF_FIT_BYTES) {
        const fit = fitGif(gif, width, height, o.fps, GIF_FIT_BYTES, say, o.transparent);
        return { bytes: fit.bytes, width: fit.width, height: fit.height, frames, note: fit.note };
      }
      return { bytes, width, height, frames };
    }
    if (o.format === "png") return { bytes: new Uint8Array(0), width, height, frames };
    onProgress({ phase: "encoding", done: 0, total: 1 });
    await encoder!.flush();
    if (failure) throw failure;
    if (mp4) { mp4.finalize(); return { bytes: new Uint8Array(mp4.target.buffer), width, height, frames }; }
    webm!.finalize();
    return { bytes: new Uint8Array(webm!.target.buffer), width, height, frames };
  } finally {
    v.offline = false;
    try { if (encoder && encoder.state !== "closed") encoder.close(); } catch { /* already closed */ }
  }
}
