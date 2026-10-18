import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import { encodeGif, type GifFrame } from "./gif";
import type { Viewer } from "./viewer";

/** "png" is a numbered sequence of PNG pictures, one per frame. */
export type VideoFormat = "mp4" | "webm" | "gif" | "png";
export type VideoSource = "live" | "turntable";

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
 * Renders the scene frame by frame (the scene is moved on by exactly one frame's time between two pictures, so the result is smooth however
 * long the pictures take) and returns the file. A turntable turns the current camera round the vertical axis through its focus.
 * A PNG sequence hands each frame to `writeFrame` as it is drawn (nothing is kept) and returns no bytes.
 * Throws `Cancelled` when `signal` aborts.
 */
export async function recordVideo(v: Viewer, o: VideoOptions, onProgress: (p: VideoProgress) => void, signal: AbortSignal,
  writeFrame?: (index: number, png: Uint8Array) => Promise<void>): Promise<{ bytes: Uint8Array; width: number; height: number; frames: number }> {
  if (o.format === "png" && !writeFrame) throw new Error("A PNG sequence needs somewhere to write its frames");
  const frames = Math.max(1, Math.round(o.seconds * o.fps));
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
  v.offline = true;
  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new Error("Cancelled");
      // (the first picture is the scene as it is now)
      clock += dt * 1000;
      v.stepFrame(clock, i === 0 ? 0 : dt);
      const shot = await v.capture(scale, o.transparent && canBeTransparent(o.format), {
        canvas: true,
        even: true,
        scaleSize: scale,
        ...(center ? { orbit: { angle: (o.turn * Math.PI / 180) * (i / frames), center } } : {}),
      });
      const canvas = shot.canvas!;
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
      if (encoder) {
        // (keeps the encoder from falling behind: its queue holds whole pictures)
        while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / o.fps), duration: Math.round(1e6 / o.fps) });
        encoder.encode(frame, { keyFrame: i % Math.max(1, o.fps * 2) === 0 });
        frame.close();
      } else if (o.format === "png") {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error(`Could not make frame ${i + 1} into a PNG`);
        await writeFrame!(i, new Uint8Array(await blob.arrayBuffer()));
      } else {
        gif.push({ data: canvas.getContext("2d")!.getImageData(0, 0, width, height).data });
      }
      onProgress({ phase: "rendering", done: i + 1, total: frames });
      // lets the interface breathe between pictures
      await new Promise((r) => setTimeout(r, 0));
    }
    if (o.format === "gif") {
      onProgress({ phase: "encoding", done: 0, total: 1 });
      await new Promise((r) => setTimeout(r, 20));
      return { bytes: encodeGif(gif, width, height, { fps: o.fps, transparent: o.transparent }), width, height, frames };
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
