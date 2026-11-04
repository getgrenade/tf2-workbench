/**
 * The post-processing panel: a list of the effects in the scene, like the outliner. An effect is added from the + Add menu (as many
 * times as the renderer can lay them over each other), switched on and off with its eye and taken out with its cross; the one that is
 * picked shows its settings in the Properties panel.
 */
import { icon } from "../icons";
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
      eye.innerHTML = icon(on ? "eye" : "eyeOff");
      eye.onclick = (e) => { e.stopPropagation(); options.toggle(item.id, !on); refresh(); };
      const remove = document.createElement("button");
      remove.className = "hierTool hierRemove";
      remove.title = `Take ${name.toLowerCase()} out of the scene`;
      remove.innerHTML = icon("x");
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
