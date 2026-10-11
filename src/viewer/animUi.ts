import { bakeSequence, listSequences } from "../api";
import type { Actor } from "./actor";
import { parseAnimInfo, parseClip, type AnimInfo, type ClipData } from "./payload";
import type { Viewer } from "./viewer";
import { isJunkSequence } from "./sequenceFilter";

export interface AnimEls {
  search: HTMLInputElement;
  /** Leaves the sequences that are of no use for showing a character out of the list. */
  junk: HTMLInputElement;
  list: HTMLSelectElement;
  play: HTMLButtonElement;
  rewind: HTMLButtonElement;
  blend: HTMLInputElement;
  speed: HTMLSelectElement;
  loop: HTMLInputElement;
  scrub: HTMLInputElement;
  frameLabel: HTMLElement;
  params: HTMLElement;
  paramsReset: HTMLButtonElement;
  paramsZero: HTMLButtonElement;
}

const BIND_POSE = -1;
/** First match wins; classes differ in which weapon slot they idle with (the Spy has no primary). */
const DEFAULT_SEQUENCES = ["stand_primary", "stand_secondary", "stand_melee"];

/** The animation selection of one character (its playback clock lives in the actor). */
export interface AnimState {
  modelPath: string;
  targetPath?: string;
  info: AnimInfo | null;
  seq: number;
  /** Encoded (0..1) pose parameter values. */
  encoded: number[];
  /** Bumped by every bake request; an older bake finishing late is dropped. */
  token: number;
  seqName: string;
}

export const newAnimState = (): AnimState => ({ modelPath: "", info: null, seq: BIND_POSE, encoded: [], token: 0, seqName: "" });

/** Baked clips are immutable, so characters playing the same sequence (and a re-picked one) share them. */
const CLIP_CACHE_SIZE = 64;
const clipCache = new Map<string, ClipData>();

/** Whether taunts are baked over the weapon pose (as the game plays them) or alone. Remembered. */
let blendTaunts = true;
try { blendTaunts = localStorage.getItem("tf2workbench.blendTaunts") !== "0"; } catch { /* the default */ }
export const blendingTaunts = () => blendTaunts;

export async function bakeClip(path: string, seq: number, params: number[], targetPath?: string): Promise<ClipData> {
  const key = `${path}|${targetPath ?? ""}|${blendTaunts ? "b" : "a"}|${seq}|${params.map((p) => p.toFixed(4)).join(",")}`;
  const hit = clipCache.get(key);
  if (hit) {
    clipCache.delete(key); // refresh its place in the LRU order
    clipCache.set(key, hit);
    return hit;
  }
  const clip = parseClip(await bakeSequence(path, seq, params, targetPath, blendTaunts));
  clipCache.set(key, clip);
  if (clipCache.size > CLIP_CACHE_SIZE) clipCache.delete(clipCache.keys().next().value!);
  return clip;
}

/**
 * Sequence browser, playback controls and pose-parameter sliders for the selected character. Sequences are baked by the Rust
 * side (port of the SDK's bone setup) at their native frame rate and played back by the viewer. Each character keeps its own
 * {@link AnimState}; `show` switches the controls over to another one.
 */
export function createAnimUi(els: AnimEls, getViewer: () => Viewer | null, getActor: () => Actor | null, getAllActors: () => Actor[] = () => [], onBlendChange: () => void = () => {}) {
  const infos = new Map<string, AnimInfo>();
  /** The state the controls edit (the selected character's). */
  let cur: AnimState = newAnimState();
  let rebakeTimer: number | undefined;
  let scrubbing = false;

  async function bake(actor: Actor, state: AnimState, keepTime: boolean) {
    const viewer = getViewer();
    if (!viewer) return;
    const shown = state === cur;
    if (state.seq === BIND_POSE) {
      state.token++;
      viewer.setClip(actor, null);
      if (shown) els.frameLabel.textContent = "bind pose";
      return;
    }
    const token = ++state.token;
    state.seqName = state.info?.sequences.find((s) => s.index === state.seq)?.name ?? String(state.seq);
    try {
      const clip = await bakeClip(state.modelPath, state.seq, state.encoded, state.targetPath);
      if (token !== state.token) return; // superseded by a newer selection
      viewer.setClip(actor, clip, keepTime);
      if (state === cur) {
        els.scrub.max = String(Math.max(clip.frames - 1, 0));
        els.scrub.disabled = clip.frames <= 1;
      }
    } catch (e) {
      if (state === cur) els.frameLabel.textContent = `failed to bake: ${String(e)}`;
    }
  }

  function fillList() {
    const { info, seq } = cur;
    els.list.innerHTML = "";
    if (!info) return;
    const q = els.search.value.trim().toLowerCase();
    els.list.add(new Option("(bind pose)", String(BIND_POSE)));
    for (const s of info.sequences) {
      // `layer_*` sequences are the overlay copies of the full-body ones (taunt03 / layer_taunt03): hidden as clutter.
      if (s.name.toLowerCase().startsWith("layer_") && s.index !== seq) continue;
      if (q && !s.name.toLowerCase().includes(q)) continue;
      // the junk is left out, but the sequence that is playing stays in the list
      if (els.junk.checked && s.index !== seq && isJunkSequence(s.name)) continue;
      const label = `${s.name}${s.looping ? " ↻" : ""}  ·  ${s.frames}f`;
      els.list.add(new Option(label, String(s.index)));
    }
    const idx = [...els.list.options].findIndex((o) => Number(o.value) === seq);
    els.list.selectedIndex = idx >= 0 ? idx : 0;
  }

  function buildParams() {
    els.params.innerHTML = "";
    const { info, encoded } = cur;
    if (!info) return;
    info.poseParams.forEach((p, i) => {
      const row = document.createElement("label");
      row.className = "slider";
      const value = p.start + encoded[i] * (p.end - p.start);
      row.innerHTML = `${p.name} <output>${value.toFixed(2)}</output>`;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(p.start);
      input.max = String(p.end);
      input.step = String((p.end - p.start) / 200);
      input.value = String(value);
      input.oninput = () => {
        cur.encoded[i] = (Number(input.value) - p.start) / (p.end - p.start);
        row.querySelector("output")!.textContent = Number(input.value).toFixed(2);
        clearTimeout(rebakeTimer);
        const actor = getActor();
        const state = cur;
        if (actor) rebakeTimer = window.setTimeout(() => void bake(actor, state, true), 80);
      };
      row.appendChild(input);
      els.params.appendChild(row);
    });
  }

  function select(actor: Actor, state: AnimState, index: number, keepTime = false) {
    state.seq = index;
    if (state === cur) {
      const i = [...els.list.options].findIndex((o) => Number(o.value) === index);
      if (i >= 0) els.list.selectedIndex = i;
    }
    void bake(actor, state, keepTime);
  }

  /**
   * Plays the first of the given sequences (case-insensitive names) that the model has. Returns whether one was found;
   * the selection is left alone otherwise.
   */
  function selectByName(actor: Actor, state: AnimState, names: string[]): boolean {
    if (!state.info) return false;
    for (const n of names) {
      const s = state.info.sequences.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (s) {
        select(actor, state, s.index);
        return true;
      }
    }
    return false;
  }

  /**
   * Poses the character for a held weapon: sets pose parameters by name (real values, case-insensitive; unknown names are
   * ignored), then plays the first of `names` the model has. With no sequence to switch to the current one is rebaked
   * with the new parameters.
   */
  function applyHeld(actor: Actor, state: AnimState, names: string[] | null, pose: Record<string, number>) {
    const { info, encoded } = state;
    if (!info) return;
    info.poseParams.forEach((p, i) => {
      const v = pose[p.name.toLowerCase()];
      if (v === undefined) return;
      encoded[i] = Math.min(Math.max((v - p.start) / (p.end - p.start || 1), 0), 1);
    });
    if (state === cur) buildParams();
    if (!(names && selectByName(actor, state, names))) void bake(actor, state, true);
  }

  /** The playback controls follow the character's own clock. */
  function syncPlayback(actor: Actor | null) {
    const pb = actor?.playback;
    if (!pb) return;
    els.play.textContent = pb.playing ? "Pause" : "Play";
    els.speed.value = String(pb.speed);
    els.loop.checked = pb.loopAll;
    const frames = pb.clip?.frames ?? 1;
    els.scrub.max = String(Math.max(frames - 1, 0));
    els.scrub.disabled = frames <= 1;
    els.scrub.value = String(pb.clip ? pb.frame() : 0);
    els.frameLabel.textContent = pb.clip ? `${cur.seqName}  ·  frame ${pb.frame().toFixed(1)} / ${frames - 1}` : cur.seq === BIND_POSE ? "bind pose" : "";
  }

  /** Switches the controls to another character's animation state. */
  function show(state: AnimState, actor: Actor | null) {
    cur = state;
    els.search.value = "";
    fillList();
    buildParams();
    syncPlayback(actor);
  }

  /** Loads the model's sequences into the state and starts the default one, for a freshly (re)loaded model. */
  async function attach(actor: Actor, state: AnimState, path: string, keep?: { seq?: number; seqName?: string; encoded?: number[] }, targetPath?: string) {
    const viewer = getViewer();
    if (!viewer) return;
    const token = ++state.token;
    state.modelPath = path;
    state.targetPath = targetPath;
    state.info = infos.get(path) ?? null;
    if (!state.info) {
      try {
        const info = parseAnimInfo(await listSequences(path));
        if (state.token !== token) return;
        state.info = info;
        infos.set(path, state.info);
      } catch (e) {
        if (state === cur) els.frameLabel.textContent = `no animations: ${String(e)}`;
        return;
      }
    }
    const info = state.info;
    state.encoded = info.poseParams.map((p) => p.default);
    const lower = info.sequences.map((s) => s.name.toLowerCase());
    const wanted = DEFAULT_SEQUENCES.find((n) => lower.includes(n)) ?? lower.find((n) => n.startsWith("stand_"));
    const def = wanted ? info.sequences[lower.indexOf(wanted)] : undefined;
    state.seq = def ? def.index : BIND_POSE;
    if (keep) {
      // a copy of another character, or a restored scene: play what was playing
      const named = keep.seqName ? lower.indexOf(keep.seqName.toLowerCase()) : -1;
      if (named >= 0) state.seq = info.sequences[named].index;
      else if (keep.seq !== undefined) state.seq = keep.seq;
      // pose parameters only carry over for the same parameter set
      if (keep.encoded && keep.encoded.length === state.encoded.length) state.encoded = keep.encoded.slice();
    }
    actor.playback.playing = true;
    if (state === cur) {
      els.search.value = "";
      fillList();
      buildParams();
      els.play.textContent = "Pause";
    }
    await bake(actor, state, false);
  }

  /** Called by the viewer every frame the selected character's pose changes. */
  function onFrame(frame: number, frames: number) {
    if (scrubbing) return;
    els.scrub.value = String(frame);
    els.frameLabel.textContent = `${cur.seqName}  ·  frame ${frame.toFixed(1)} / ${frames - 1}`;
  }

  els.search.oninput = fillList;
  try { els.junk.checked = localStorage.getItem("tf2workbench.hideJunk") !== "0"; } catch { /* on */ }
  els.junk.onchange = () => {
    try { localStorage.setItem("tf2workbench.hideJunk", els.junk.checked ? "1" : "0"); } catch { /* not remembered */ }
    fillList();
  };
  els.list.onchange = () => {
    const actor = getActor();
    if (actor) select(actor, cur, Number(els.list.value));
  };
  els.play.title = "Play or pause. Ctrl+click plays or pauses every character at once (to start several taunts together).";
  els.play.onclick = (event) => {
    if (event.ctrlKey || event.metaKey) {
      // the whole scene follows the shown character: playing ones pause everyone, a paused one starts everyone
      const play = !getActor()?.playback.playing;
      for (const actor of getAllActors()) if (actor.playback.clip) actor.playback.playing = play;
      els.play.textContent = play ? "Pause" : "Play";
      return;
    }
    const pb = getActor()?.playback;
    if (!pb) return;
    pb.playing = !pb.playing;
    els.play.textContent = pb.playing ? "Pause" : "Play";
  };
  els.rewind.onclick = (event) => {
    const actors = event.ctrlKey || event.metaKey ? getAllActors() : [getActor()];
    for (const actor of actors) actor?.playback.setFrame(0);
    const pb = getActor()?.playback;
    if (pb?.clip) {
      els.scrub.value = "0";
      els.frameLabel.textContent = `${cur.seqName}  ·  frame 0.0 / ${pb.clip.frames - 1}`;
    }
  };
  els.blend.checked = blendTaunts;
  els.blend.onchange = () => {
    blendTaunts = els.blend.checked;
    try { localStorage.setItem("tf2workbench.blendTaunts", blendTaunts ? "1" : "0"); } catch { /* not remembered */ }
    onBlendChange();
  };
  els.speed.onchange = () => {
    const pb = getActor()?.playback;
    if (pb) pb.speed = Number(els.speed.value);
  };
  els.loop.onchange = () => {
    const pb = getActor()?.playback;
    if (pb) pb.loopAll = els.loop.checked;
  };
  els.scrub.oninput = () => {
    const pb = getActor()?.playback;
    if (!pb) return;
    scrubbing = true;
    pb.playing = false;
    els.play.textContent = "Play";
    pb.setFrame(Number(els.scrub.value));
    els.frameLabel.textContent = `frame ${Number(els.scrub.value).toFixed(1)}`;
  };
  els.scrub.onchange = () => (scrubbing = false);
  els.paramsReset.onclick = () => {
    const actor = getActor();
    if (!cur.info || !actor) return;
    cur.encoded = cur.info.poseParams.map((p) => p.default);
    buildParams();
    void bake(actor, cur, true);
  };

  els.paramsZero.onclick = () => {
    const actor = getActor();
    if (!cur.info || !actor) return;
    cur.encoded = cur.info.poseParams.map(() => 0);
    buildParams();
    void bake(actor, cur, true);
  };

  /** Every sequence name of the attached model (including the hidden `layer_` ones). */
  const sequenceNames = (state: AnimState) => state.info?.sequences.map((s) => s.name) ?? [];

  /** Plays the selected sequence again (after posing, which replaced it with a frozen pose). */
  function refresh(actor: Actor, state: AnimState) {
    actor.playback.playing = true;
    if (state === cur) els.play.textContent = "Pause";
    void bake(actor, state, false);
  }

  /** Bakes the character's sequence again, keeping its time (after the taunt blending changed). */
  function rebake(actor: Actor, state: AnimState) {
    if (state.seq !== BIND_POSE && state.info) void bake(actor, state, true);
  }

  return { attach, show, selectByName, applyHeld, sequenceNames, onFrame, refresh, rebake };
}
