/**
 * The voice line browser: a class's lines (from its response rules, grouped by what they are for), searchable; one plays on the selected
 * character with its scene's face and its lip sync, on a timeline of its own to scrub for a good face, which can be kept on the flex
 * sliders.
 */
import type { VoiceLine } from "../api";

export interface VoiceLinesHost {
  /** The selected character's class ("Heavy") and the game's name for it ("heavy"); null without a character. */
  character(): { label: string; game: string } | null;
  lines(game: string): Promise<VoiceLine[]>;
  /** Puts a line on the selected character (null: lets go, the animation's own face comes back). Resolves to its length in seconds. */
  play(line: VoiceLine | null): Promise<number>;
  /** Moves the line's timeline (seconds) and plays or holds it there. */
  seek(time: number, playing: boolean): void;
  /** Where the line is now (seconds), and whether it plays. */
  position(): { time: number; playing: boolean };
  /** Keeps the face of this moment on the flex sliders. */
  keepFace(): void;
}

let closeOpen: (() => void) | null = null;

export function closeVoiceLines() {
  closeOpen?.();
}

/** "vo/heavy_cloakedspyidentify05.mp3" -> "heavy_cloakedspyidentify05". */
const waveName = (wave: string) => wave.split("/").pop()!.replace(/\.(mp3|wav)$/i, "");

export function openVoiceLines(host: VoiceLinesHost) {
  if (closeOpen) return;
  const win = document.createElement("div");
  win.className = "chartWindow rollWindow voiceWindow";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Voice lines");
  win.innerHTML = `<div class="chartHead"><span>Voice lines</span><button class="chartClose" title="Close" aria-label="Close">×</button></div>
    <div class="rollBody">
      <input type="search" class="voiceSearch" placeholder="Search: what it is for, or the file (laugh, medic, taunt…)" spellcheck="false" />
      <div class="voiceList" role="listbox" aria-label="Voice lines"></div>
      <div class="voiceNow">
        <div class="voiceTitle dim">Pick a line to play it on the selected character.</div>
        <input type="range" class="voiceScrub" min="0" max="1" step="0.001" value="0" disabled aria-label="Where in the line" />
        <div class="btns"><button class="voicePlay" disabled>Play</button><label class="inline"><input type="checkbox" class="voiceLoop" /> Loop</label><button class="voiceKeep" disabled title="Put the face of this moment on the flex sliders (it stays when the line is let go)">Keep this face</button><button class="voiceRelease" disabled title="Take the line off: the animation's own face comes back">Let go</button></div>
      </div>
      <p class="chartInfo" role="status"></p>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => win.querySelector(sel) as T;
  const head = $(".chartHead"), search = $<HTMLInputElement>(".voiceSearch"), list = $(".voiceList"), title = $(".voiceTitle");
  const scrub = $<HTMLInputElement>(".voiceScrub"), playBtn = $<HTMLButtonElement>(".voicePlay"), loop = $<HTMLInputElement>(".voiceLoop");
  const keep = $<HTMLButtonElement>(".voiceKeep"), release = $<HTMLButtonElement>(".voiceRelease"), status = $(".chartInfo");

  let lines: VoiceLine[] = [];
  let game = "";
  let current: VoiceLine | null = null;
  let length = 0;
  let raf = 0;

  const matches = (l: VoiceLine, q: string) => !q || `${l.group} ${l.sound.name} ${l.sound.waves.join(" ")}`.toLowerCase().includes(q);
  function render() {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = "";
    let group: string | null = null;
    let shown = 0;
    for (const l of lines) {
      if (!matches(l, q)) continue;
      if (l.group !== group) {
        group = l.group;
        const h = document.createElement("div");
        h.className = "voiceGroup";
        h.textContent = group || "Other";
        list.appendChild(h);
      }
      const b = document.createElement("button");
      b.className = "voiceItem";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(l === current));
      b.textContent = waveName(l.sound.waves[0] ?? l.sound.name);
      b.title = `${l.sound.name}${l.duration ? ` · ${l.duration.toFixed(1)} s` : ""}`;
      b.onclick = () => void pick(l);
      list.appendChild(b);
      if (++shown >= 400) break;
    }
    if (!shown) list.textContent = lines.length ? "Nothing matches." : "Loading…";
  }

  async function load() {
    const c = host.character();
    if (!c) { status.textContent = "Select a character first."; return; }
    if (c.game === game && lines.length) return;
    game = c.game;
    (head.querySelector("span") as HTMLElement).textContent = `Voice lines: ${c.label}`;
    lines = [];
    render();
    try {
      lines = await host.lines(game);
      status.textContent = `${lines.length} lines.`;
    } catch (err) {
      status.textContent = `Could not read the voice lines: ${String(err)}`;
    }
    render();
  }

  async function pick(l: VoiceLine | null) {
    current = l;
    render();
    length = await host.play(l);
    const on = !!l && length > 0;
    scrub.disabled = playBtn.disabled = keep.disabled = release.disabled = !on;
    scrub.max = String(Math.max(0.01, length));
    scrub.value = "0";
    title.textContent = on ? `${l!.group}: ${waveName(l!.sound.waves[0] ?? l!.sound.name)} (${length.toFixed(1)} s)` : "Pick a line to play it on the selected character.";
    title.classList.toggle("dim", !on);
    if (on) host.seek(0, true);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!current) return;
    const p = host.position();
    let t = p.time;
    if (p.playing && t >= length) {
      if (loop.checked) host.seek((t = 0), true);
      else host.seek((t = length), false);
    }
    if (document.activeElement !== scrub) scrub.value = String(t);
    playBtn.textContent = host.position().playing ? "Pause" : "Play";
  }

  search.oninput = render;
  scrub.oninput = () => host.seek(Number(scrub.value), false);
  playBtn.onclick = () => {
    const p = host.position();
    host.seek(p.time >= length ? 0 : p.time, !p.playing);
  };
  keep.onclick = () => { host.keepFace(); status.textContent = "The face is on the flex sliders."; };
  release.onclick = () => void pick(null);

  head.onpointerdown = (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return;
    const r = win.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    head.setPointerCapture(ev.pointerId);
    head.onpointermove = (m) => {
      win.style.left = `${Math.min(Math.max(0, m.clientX - dx), innerWidth - 80)}px`;
      win.style.top = `${Math.min(Math.max(0, m.clientY - dy), innerHeight - 40)}px`;
      win.style.right = "auto";
    };
    head.onpointerup = () => (head.onpointermove = null);
  };
  const close = () => {
    cancelAnimationFrame(raf);
    void host.play(null);
    win.remove();
    closeOpen = null;
  };
  ($(".chartClose") as HTMLButtonElement).onclick = close;
  win.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    else if (ev.key === " " && current && !(ev.target as HTMLElement).matches("input[type=search], button")) { ev.preventDefault(); playBtn.click(); }
  });
  // another character selected: its class's lines
  win.addEventListener("pointerenter", () => void load());
  document.body.appendChild(win);
  closeOpen = close;
  raf = requestAnimationFrame(tick);
  void load();
  search.focus();
}
