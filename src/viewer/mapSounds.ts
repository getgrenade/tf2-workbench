/**
 * A map's sounds, as the game plays them around the listener (the camera): its ambient_generics (each a sound where it is, fading out
 * by its radius; some heard everywhere) and its soundscapes (the env_soundscape nearest the listener that it can see sets the sounds of
 * the area: its looping waves and, now and then, one of its random ones). Heard while the sound is on.
 */
import * as THREE from "three";
import { mapSounds as fetchMapSounds, type MapSoundsJson } from "../api";
import { audioContext, loadVoice } from "./voicePlayer";

type V3 = [number, number, number];

/** How loud the map's sounds are against the voice lines. */
const MASTER = 0.6;
/** How often the area's soundscape is looked for again (ms), and how long the change fades (s). */
const ZONE_EVERY = 500;
const FADE = 1.5;

interface Layer {
  gain: GainNode;
  sources: AudioBufferSourceNode[];
  timers: number[];
  alive: boolean;
}

export class MapSounds {
  private data: MapSoundsJson | null = null;
  private master: GainNode | null = null;
  private started = false;
  private disposed = false;
  private readonly ambientSources: AudioBufferSourceNode[] = [];
  private zone: string | null = null;
  private layer: Layer | null = null;
  private zoneAsked = 0;

  /**
   * `toView`: a point of the map (its units, z up) in the view; `blocked`: whether the map's walls stand between two points of the view.
   */
  constructor(
    name: string,
    private readonly toView: (p: V3) => THREE.Vector3,
    private readonly blocked: (from: THREE.Vector3, to: THREE.Vector3) => boolean,
  ) {
    void fetchMapSounds(name)
      .then((d) => { if (!this.disposed) this.data = d; })
      .catch(() => undefined);
  }

  /** Every frame: the listener where the camera is; the sounds on or off (`on`: the sound is on and the map is shown). */
  update(camera: THREE.Camera, on: boolean) {
    if (this.disposed || !this.data) return;
    if (!on && !this.started) return;
    const ctx = audioContext();
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
    }
    this.master.gain.setTargetAtTime(on ? MASTER : 0, ctx.currentTime, 0.2);
    if (!on) return;
    if (!this.started) {
      this.started = true;
      this.startAmbients();
    }
    // the listener: where the camera is, looking where it looks
    camera.updateMatrixWorld();
    const p = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    const now = performance.now();
    if (now - this.zoneAsked > ZONE_EVERY) {
      this.zoneAsked = now;
      const zone = this.zoneAt(p);
      if (zone !== null && zone !== this.zone) this.playSoundscape(zone);
    }
  }

  /** The soundscape of the area at `p`: the nearest zone that reaches it and that it sees (else the nearest that reaches it). */
  private zoneAt(p: THREE.Vector3): string | null {
    let best: { d: number; name: string } | null = null;
    let fallback: { d: number; name: string } | null = null;
    for (const z of this.data?.zones ?? []) {
      const at = this.toView(z.origin);
      const d = at.distanceTo(p);
      if (z.radius >= 0 && d > z.radius) continue;
      if (!fallback || d < fallback.d) fallback = { d, name: z.soundscape };
      if ((!best || d < best.d) && !this.blocked(p, at)) best = { d, name: z.soundscape };
    }
    return (best ?? fallback)?.name ?? null;
  }

  /** The ambient_generics: each looping where it is (or everywhere), fading out by its radius. */
  private startAmbients() {
    const ctx = audioContext();
    for (const a of this.data?.ambients ?? []) {
      // (one that starts silent waits for the game to turn it on; one that does not loop plays when something triggers it)
      if (a.silent || !a.looped) continue;
      void loadVoice(a.waves[0]).then((buffer) => {
        if (!buffer || this.disposed || !this.master) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.playbackRate.value = a.pitch;
        const gain = ctx.createGain();
        gain.gain.value = a.volume;
        src.connect(gain);
        if (a.everywhere) gain.connect(this.master);
        else {
          const panner = ctx.createPanner();
          panner.panningModel = "equalpower";
          panner.distanceModel = "linear";
          panner.refDistance = Math.min(64, a.radius * 0.1);
          panner.maxDistance = Math.max(a.radius, 1);
          panner.rolloffFactor = 1;
          const at = this.toView(a.origin);
          if (panner.positionX) { panner.positionX.value = at.x; panner.positionY.value = at.y; panner.positionZ.value = at.z; }
          else panner.setPosition(at.x, at.y, at.z);
          gain.connect(panner);
          panner.connect(this.master);
        }
        // (each starts at a place of its own: the same wave in two places does not play in step)
        src.start(0, Math.random() * buffer.duration);
        this.ambientSources.push(src);
      });
    }
  }

  /** Changes the area's sounds to a soundscape's, fading the old ones out. */
  private playSoundscape(name: string) {
    const ctx = audioContext();
    this.zone = name;
    if (this.layer) this.endLayer(this.layer);
    const scape = this.data?.soundscapes[name];
    if (!scape || !this.master) { this.layer = null; return; }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, FADE / 3);
    gain.connect(this.master);
    const layer: Layer = { gain, sources: [], timers: [], alive: true };
    this.layer = layer;
    for (const l of scape.looping) {
      void loadVoice(l.wave).then((buffer) => {
        if (!buffer || !layer.alive) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.playbackRate.value = l.pitch;
        const g = ctx.createGain();
        g.gain.value = l.volume;
        src.connect(g).connect(gain);
        src.start(0, Math.random() * buffer.duration);
        layer.sources.push(src);
      });
    }
    const between = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    for (const r of scape.random) {
      const next = () => {
        if (!layer.alive) return;
        layer.timers.push(window.setTimeout(() => {
          if (!layer.alive) return;
          const wave = r.waves[Math.floor(Math.random() * r.waves.length)];
          void loadVoice(wave).then((buffer) => {
            if (!buffer || !layer.alive) return;
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.value = between(r.pitch);
            const g = ctx.createGain();
            g.gain.value = between(r.volume);
            // (somewhere around the listener, as the game places them)
            const pan = ctx.createStereoPanner();
            pan.pan.value = Math.random() * 1.6 - 0.8;
            src.connect(g).connect(pan).connect(gain);
            src.start();
            layer.sources.push(src);
            src.onended = () => { layer.sources = layer.sources.filter((s) => s !== src); };
          });
          next();
        }, between(r.time) * 1000));
      };
      next();
    }
  }

  private endLayer(layer: Layer) {
    const ctx = audioContext();
    layer.alive = false;
    for (const t of layer.timers) clearTimeout(t);
    layer.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE / 3);
    const stop = () => { for (const s of layer.sources) { try { s.stop(); } catch { /* already ended */ } } layer.gain.disconnect(); };
    window.setTimeout(stop, FADE * 1000 + 200);
  }

  dispose() {
    this.disposed = true;
    if (this.layer) this.endLayer(this.layer);
    for (const s of this.ambientSources) { try { s.stop(); } catch { /* already ended */ } }
    this.master?.disconnect();
  }
}
