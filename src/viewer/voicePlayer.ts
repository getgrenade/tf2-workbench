/**
 * The voice lines of scenes: decoded once and played in step with a clock the caller gives (the character's animation). Muting is
 * remembered.
 */
import { readSound } from "../api";

const KEY = "tf2workbench.voiceMuted";
/** How far the sound may drift from the clock before it is started again at the right place. */
const DRIFT = 0.12;

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let muted = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export const voiceMuted = () => muted;
export function setVoiceMuted(on: boolean) {
  muted = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* not kept */ }
  if (on) stopAll();
}

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A wave (`vo/heavy_laugh01.mp3`), decoded; null when it cannot be read or decoded. */
export function loadVoice(wave: string): Promise<AudioBuffer | null> {
  let p = buffers.get(wave);
  if (!p) {
    p = readSound(wave)
      .then((bytes) => audio().decodeAudioData(bytes.slice(0)))
      .catch((err) => {
        console.warn(`could not play ${wave}:`, err);
        return null;
      });
    buffers.set(wave, p);
  }
  return p;
}

interface Playing {
  source: AudioBufferSourceNode;
  /** The audio clock time the sound's start lines up with. */
  zero: number;
}

const playing = new Map<string, Playing>();

function stop(key: string) {
  const p = playing.get(key);
  if (!p) return;
  try { p.source.stop(); } catch { /* already stopped */ }
  playing.delete(key);
}

/** Stops every sound of an owner (or all of them). */
export function stopAll(owner?: string) {
  for (const key of [...playing.keys()]) if (!owner || key.startsWith(`${owner}|`)) stop(key);
}

/**
 * Keeps one sound of `owner` in step with a clock: playing from `offset` seconds into it while `run` (and not muted), stopped otherwise
 * or when the offset is outside the sound. Called every frame; it only (re)starts the sound when it drifted or was not playing.
 */
export function syncVoice(owner: string, slot: string, buffer: AudioBuffer, offset: number, run: boolean) {
  const key = `${owner}|${slot}`;
  if (!run || muted || offset < 0 || offset >= buffer.duration - 0.02) {
    stop(key);
    return;
  }
  const a = audio();
  const p = playing.get(key);
  if (p && Math.abs(a.currentTime - p.zero - offset) < DRIFT) return;
  stop(key);
  const source = a.createBufferSource();
  source.buffer = buffer;
  source.connect(a.destination);
  source.start(0, offset);
  const entry = { source, zero: a.currentTime - offset };
  source.onended = () => { if (playing.get(key) === entry) playing.delete(key); };
  playing.set(key, entry);
}
