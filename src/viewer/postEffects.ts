/**
 * The post-processing panel: a list of the effects in the scene, like the outliner. An effect is added from the + Add menu (as many
 * times as the renderer can lay them over each other), switched on and off with its eye and taken out with its cross; the one that is
 * picked shows its settings in the Properties panel.
 */
import { openMenu } from "./popMenu";
import { canAdd, countOf, POST_GROUPS, POST_KINDS, POST_KIND_ORDER, postLabel, type PostItem, type PostKind } from "./postStack";

interface PostUiOptions {
  list: HTMLElement;
  add: HTMLButtonElement;
  items(): PostItem[];
  selected(): string | null;
  select(id: string): void;
  toggle(id: string, on: boolean): void;
  remove(id: string): void;
  addKind(kind: PostKind): void;
}

const EYE = "M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z M11.500 9a2.500 2.500 0 1 0-5 0 2.500 2.500 0 1 0 5 0";
const HIDDEN = "M2 2l14 14 M1 9s3-5 8-5c5 0 8 5 8 5s-3 5-8 5-8-5-8-5z";
const CROSS = "M4 4l10 10 M14 4L4 14";
const svg = (d: string) => `<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="${d}"/></svg>`;

export function createPostUi(options: PostUiOptions) {
  const { list, add } = options;
  let key = "";

  function refresh(force = false) {
    const items = options.items();
    const selected = options.selected();
    const next = items.map((i) => `${i.id}:${+i.state.enabled}:${postLabel(items, i)}`).join() + "|" + (selected ?? "");
    if (!force && next === key) return;
    key = next;
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "hierEmpty";
      empty.textContent = "No effects. Add one with + Add.";
      list.append(empty);
    }
    for (const item of items) {
      const name = postLabel(items, item);
      const on = item.state.enabled;
      const row = document.createElement("div");
      row.className = "hierRow hierObject" + (selected === item.id ? " selected primary" : "") + (on ? "" : " dimmed");
      row.dataset.effect = item.id;
      const label = document.createElement("span");
      label.className = "hierLabel";
      label.textContent = name;
      const eye = document.createElement("button");
      eye.className = "hierEye";
      eye.title = on ? `Turn ${name.toLowerCase()} off` : `Turn ${name.toLowerCase()} on`;
      eye.setAttribute("aria-pressed", String(!on));
      eye.innerHTML = svg(on ? EYE : HIDDEN);
      eye.onclick = (e) => { e.stopPropagation(); options.toggle(item.id, !on); refresh(); };
      const remove = document.createElement("button");
      remove.className = "hierTool hierRemove";
      remove.title = `Take ${name.toLowerCase()} out of the scene`;
      remove.innerHTML = svg(CROSS);
      remove.onclick = (e) => { e.stopPropagation(); options.remove(item.id); refresh(); };
      row.append(label, remove, eye);
      row.onclick = () => { options.select(item.id); refresh(); };
      list.append(row);
    }
  }

  add.onclick = () => {
    const items = options.items();
    openMenu(add, POST_KIND_ORDER.map((kind) => ({
      separator: POST_GROUPS.some((g, i) => i > 0 && g[0] === kind),
      label: POST_KINDS[kind].label,
      hint: POST_KINDS[kind].max > 1 ? `${countOf(items, kind)} of ${POST_KINDS[kind].max}` : undefined,
      disabled: !canAdd(items, kind),
      run: () => { options.addKind(kind); refresh(); },
    })));
  };

  refresh();
  return { refresh };
}
