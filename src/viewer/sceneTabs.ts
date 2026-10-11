/** The strip of open scenes above the 3D view, like the document tabs of an image editor. */

export interface TabInfo {
  id: number;
  name: string;
  dirty: boolean;
}

export interface TabHandlers {
  select(id: number): void;
  close(id: number): void;
  add(): void;
  rename(id: number, name: string): void;
}

export function createSceneTabs(root: HTMLElement, h: TabHandlers): { render: (tabs: TabInfo[], active: number) => void } {
  let editing = -1;
  let last: { tabs: TabInfo[]; active: number } = { tabs: [], active: -1 };

  function render(tabs: TabInfo[], active: number) {
    last = { tabs, active };
    root.replaceChildren();
    for (const t of tabs) {
      const b = document.createElement("div");
      b.className = "sceneTab" + (t.id === active ? " on" : "");
      b.title = `${t.name}${t.dirty ? " (modified)" : ""}: click to open, double-click to rename, middle-click to close`;
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
      b.onauxclick = (ev) => {
        if (ev.button === 1) {
          ev.preventDefault();
          h.close(t.id);
        }
      };
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
