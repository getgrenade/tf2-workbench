/** The strip of open scenes above the 3D view, like the document tabs of an image editor. */

export interface TabInfo {
  id: number;
  name: string;
  dirty: boolean;
  /** A picture of the scene's view, shown when the pointer rests on a tab that is not in front. */
  preview?: string;
}

const PREVIEW_DELAY = 350;

export interface TabHandlers {
  select(id: number): void;
  close(id: number): void;
  add(): void;
  rename(id: number, name: string): void;
}

export function createSceneTabs(root: HTMLElement, h: TabHandlers): { render: (tabs: TabInfo[], active: number) => void } {
  let editing = -1;
  let last: { tabs: TabInfo[]; active: number } = { tabs: [], active: -1 };

  // the preview card: one for the strip, placed under the tab the pointer rests on
  const card = document.createElement("div");
  card.className = "sceneTabPreview";
  card.hidden = true;
  const cardImg = document.createElement("img");
  cardImg.alt = "";
  const cardName = document.createElement("div");
  cardName.className = "sceneTabPreviewName";
  card.append(cardImg, cardName);
  document.body.append(card);
  let timer = 0;
  const hidePreview = () => { window.clearTimeout(timer); card.hidden = true; };
  function showPreview(tab: HTMLElement, t: TabInfo) {
    cardImg.src = t.preview!;
    cardName.textContent = t.name + (t.dirty ? " (modified)" : "");
    card.hidden = false;
    const a = tab.getBoundingClientRect();
    const w = card.offsetWidth;
    card.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - w - 8))}px`;
    card.style.top = `${a.bottom + 4}px`;
  }

  function render(tabs: TabInfo[], active: number) {
    last = { tabs, active };
    hidePreview();
    root.replaceChildren();
    for (const t of tabs) {
      const b = document.createElement("div");
      b.className = "sceneTab" + (t.id === active ? " on" : "");
      const hint = `${t.name}${t.dirty ? " (modified)" : ""}: click to open, double-click to rename, middle-click to close`;
      // a tab with a picture shows it instead of the plain tooltip (the two would cover each other)
      if (t.preview && t.id !== active) {
        b.setAttribute("aria-label", hint);
        b.onpointerenter = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (b.isConnected && editing < 0) showPreview(b, t); }, PREVIEW_DELAY); };
        b.onpointerleave = hidePreview;
        b.addEventListener("pointerdown", hidePreview);
      } else {
        b.title = hint;
      }
      if (editing === t.id) {
        const input = document.createElement("input");
        input.value = t.name;
        const done = (ok: boolean) => {
          if (editing !== t.id) return;
          editing = -1;
          if (ok && input.value.trim()) h.rename(t.id, input.value.trim());
          else render(last.tabs, last.active);
        };
        input.onkeydown = (ev) => {
          if (ev.key === "Enter") done(true);
          else if (ev.key === "Escape") done(false);
          ev.stopPropagation();
        };
        input.onblur = () => done(true);
        input.onpointerdown = (ev) => ev.stopPropagation();
        b.appendChild(input);
        queueMicrotask(() => {
          input.focus();
          input.select();
        });
      } else {
        const label = document.createElement("span");
        label.className = "sceneTabName";
        label.textContent = t.name + (t.dirty ? " •" : "");
        b.appendChild(label);
      }
      const x = document.createElement("button");
      x.className = "sceneTabClose";
      x.textContent = "×";
      x.title = "Close this scene";
      x.onclick = (ev) => {
        ev.stopPropagation();
        h.close(t.id);
      };
      b.appendChild(x);
      b.onclick = () => {
        if (editing < 0 && t.id !== active) h.select(t.id);
      };
      b.ondblclick = () => {
        editing = t.id;
        render(last.tabs, last.active);
      };
      // middle-click closes the tab: the press is taken (or the browser starts its autoscroll on it) and the release closes
      b.onpointerdown = (ev) => {
        if (ev.button === 1) ev.preventDefault();
      };
      b.onpointerup = (ev) => {
        if (ev.button !== 1 || editing === t.id) return;
        ev.preventDefault();
        h.close(t.id);
      };
      b.onauxclick = (ev) => ev.preventDefault();
      root.appendChild(b);
    }
    const add = document.createElement("button");
    add.className = "sceneTabAdd";
    add.textContent = "+";
    add.title = "New scene";
    add.onclick = () => h.add();
    root.appendChild(add);
  }
  return { render };
}
