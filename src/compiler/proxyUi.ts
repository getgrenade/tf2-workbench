import { openMenu, type MenuItem } from "../viewer/popMenu";
import { COMMON_TARGETS, PROXY_PRESETS, PROXY_TYPES, cloneProxies, newProxy, proxiesFromText, proxiesToText, proxyProblems, proxyType, type CustomProxy } from "./proxyModel";

/** What the editor needs of the panel it sits in. */
export interface ProxyEditorHost {
  proxies(): CustomProxy[];
  /** The list changed. `rebuild`: the panel is drawn again (a proxy came, went or moved); otherwise only the preview follows (a value was typed). */
  commit(next: CustomProxy[], rebuild: boolean): void;
  /** Whether the material glows (a proxy that drives the glow does nothing without it). */
  selfIllum(): boolean;
}

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string; title?: string } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Whether the text box is open (kept when the panel is drawn again). */
let showText = false;
const TARGETS_ID = "cmpProxyTargets";
const ICON = {
  up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>',
  copy: '<svg viewBox="0 0 16 16"><rect x="5.500" y="5.500" width="8" height="8" rx="1.500"/><path d="M10.500 5.500v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  remove: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

function iconButton(icon: string, title: string, run: () => void, disabled = false) {
  const b = h("button", { type: "button", className: "cmpProxyBtn", title, disabled });
  b.setAttribute("aria-label", title);
  b.innerHTML = icon;
  b.onclick = (e) => { e.stopPropagation(); run(); };
  return b;
}

/**
 * The proxies of a material that the artist adds: a list of cards (what the proxy is, then its keys), added from a menu of kinds and
 * ready-made ones, edited in place, moved, copied and removed, or all of them as text. Proxies of the kinds the viewer runs (Sine,
 * TextureScroll...) show in the preview as they are edited.
 */
export function createProxyEditor(host: ProxyEditorHost): HTMLElement {
  const root = h("div", { className: "cmpProxies" });

  const edit = (change: (list: CustomProxy[]) => void, rebuild: boolean) => {
    const next = cloneProxies(host.proxies());
    change(next);
    host.commit(next, rebuild);
  };

  const targets = h("datalist", { id: TARGETS_ID });
  for (const t of COMMON_TARGETS) targets.append(h("option", { value: t }));

  /** One key of a proxy: its label and a box (the keys the editor knows are always shown, the others come with a button that drops them). */
  function row(index: number, key: string, label: string, hint: string, list: boolean, extra: boolean) {
    const proxy = host.proxies()[index];
    const current = proxy.params.find((a) => a.key.toLowerCase() === key.toLowerCase());
    const input = h("input", { className: "text", type: "text", value: current?.value ?? "", spellcheck: false, title: hint });
    if (list) input.setAttribute("list", TARGETS_ID);
    input.placeholder = list ? "$variable" : "";
    input.onchange = () => edit((all) => {
      const p = all[index];
      const at = p.params.findIndex((a) => a.key.toLowerCase() === key.toLowerCase());
      const value = input.value.trim();
      if (at >= 0) p.params[at].value = value; else if (value !== "") p.params.push({ key, value });
    }, false);
    const out = h("div", { className: "cmpProxyRow" }, h("span", { className: "dim", textContent: label, title: hint }), input);
    if (extra) out.append(iconButton(ICON.remove, `Remove ${key}`, () => edit((all) => { all[index].params = all[index].params.filter((a) => a.key.toLowerCase() !== key.toLowerCase()); }, true)));
    return out;
  }

  function card(proxy: CustomProxy, index: number, total: number) {
    const type = proxyType(proxy.name);
    const known = new Set((type?.params ?? []).map((p) => p.key.toLowerCase()));
    const folded = proxy.folded === true;
    const target = proxy.params.find((a) => a.key.toLowerCase() === "resultvar" || a.key.toLowerCase() === "texturescrollvar")?.value ?? "";
    const toggle = h("button", { type: "button", className: "cmpProxyFold" + (folded ? " closed" : ""), title: folded ? "Open" : "Fold" });
    toggle.setAttribute("aria-expanded", String(!folded));
    toggle.onclick = () => edit((all) => { all[index].folded = !folded; }, true);
    const head = h("div", { className: "cmpProxyHead" },
      toggle,
      h("span", { className: "cmpProxyName", textContent: proxy.name, title: type?.hint ?? "A proxy the editor has no layout for: its keys and values are edited as they are", onclick: () => toggle.click() }),
      folded && target ? h("span", { className: "dim cmpProxyTarget", textContent: target, title: target }) : null,
      iconButton(ICON.up, "Move up (proxies run in this order)", () => edit((all) => { [all[index - 1], all[index]] = [all[index], all[index - 1]]; }, true), index === 0),
      iconButton(ICON.down, "Move down", () => edit((all) => { [all[index + 1], all[index]] = [all[index], all[index + 1]]; }, true), index === total - 1),
      iconButton(ICON.copy, "Copy as text", () => { void navigator.clipboard?.writeText(proxiesToText([proxy])).catch(() => {}); }),
      iconButton(ICON.remove, "Remove this proxy", () => edit((all) => { all.splice(index, 1); }, true)));
    const body = h("div", { className: "cmpProxyBody" });
    for (const p of type?.params ?? []) body.append(row(index, p.key, p.label, p.hint ?? p.key, p.kind === "var", false));
    // keys of the proxy that the editor does not lay out: shown with their own names
    for (const a of proxy.params) if (!known.has(a.key.toLowerCase())) body.append(row(index, a.key, a.key, a.key, /var\d*$/i.test(a.key), true));
    const add = h("button", { type: "button", className: "cmpProxyAdd", textContent: "+ key", title: "Add a key and value to this proxy" });
    add.onclick = () => {
      const key = h("input", { className: "text", type: "text", placeholder: "key", spellcheck: false });
      const value = h("input", { className: "text", type: "text", placeholder: "value", spellcheck: false });
      const done = () => {
        if (key.value.trim() === "") { root.dispatchEvent(new Event("redraw")); return; }
        edit((all) => { all[index].params.push({ key: key.value.trim(), value: value.value.trim() }); }, true);
      };
      value.onchange = done;
      key.onkeydown = (e) => { if (e.key === "Enter") value.focus(); if (e.key === "Escape") root.dispatchEvent(new Event("redraw")); };
      value.onkeydown = (e) => { if (e.key === "Escape") root.dispatchEvent(new Event("redraw")); };
      add.replaceWith(h("div", { className: "cmpProxyRow cmpProxyNew" }, key, value));
      key.focus();
    };
    body.append(add);
    body.hidden = folded;
    return h("div", { className: "cmpProxy" + (folded ? " folded" : ""), }, head, body);
  }

  function menu(anchor: HTMLElement) {
    const items: MenuItem[] = [
      ...PROXY_PRESETS.map((p) => ({ label: p.label, hint: p.hint.length > 28 ? "" : p.hint, run: () => edit((all) => { all.push(p.proxy()); }, true) })),
      { label: "Other proxies", separator: true, children: PROXY_TYPES.map((t) => ({ label: t.name, run: () => edit((all) => { all.push(newProxy(t.name)); }, true) })) },
      { label: "Custom (any name)…", run: () => edit((all) => { all.push({ name: "NewProxy", params: [{ key: "resultVar", value: "" }] }); }, true) },
      { label: "Paste from text…", separator: true, run: () => { showText = true; root.dispatchEvent(new Event("redraw")); } },
    ];
    openMenu(anchor, items);
  }

  function draw() {
    const list = host.proxies();
    const add = h("button", { type: "button", textContent: "Add ▾", title: "Add a proxy: they run after the ones the importer adds, and are written into the material the same way" });
    add.onclick = () => menu(add);
    const body: Child[] = [h("div", { className: "cmpProxyBar" }, add)];
    if (!list.length) body.push(h("div", { className: "dim hint", textContent: "Nothing added. A proxy animates a value of the material: a glow that pulses, a texture that scrolls." }));
    list.forEach((p, i) => body.push(card(p, i, list.length)));
    const problems = proxyProblems(list, host.selfIllum());
    if (problems.length) body.push(h("div", { className: "dim hint err", textContent: problems.join("\n") }));
    // all of them as text, to paste into or copy out of
    const toggle = h("button", { type: "button", className: "cmpProxyAdd", textContent: showText ? "Hide text" : "Edit as text", title: "The proxies as the material file has them: edit or paste, then click away" });
    toggle.onclick = () => { showText = !showText; draw(); };
    body.push(toggle);
    if (showText) {
      const area = h("textarea", { className: "cmpProxyText", value: proxiesToText(list), spellcheck: false, rows: Math.min(14, Math.max(5, proxiesToText(list).split("\n").length + 1)) });
      area.placeholder = '"Sine"\n{\n\t"sinePeriod"\t\t"2"\n\t"resultVar"\t\t"$selfillumtint"\n}';
      const note = h("div", { className: "dim hint" });
      area.onchange = () => {
        try {
          const next = proxiesFromText(area.value);
          note.textContent = "";
          host.commit(next, true);
        } catch (e) { note.textContent = `Not read: ${e instanceof Error ? e.message : String(e)}`; note.classList.add("err"); }
      };
      body.push(area, note);
    }
    root.replaceChildren(targets, ...(body.filter(Boolean) as Node[]));
  }
  root.addEventListener("redraw", draw);
  draw();
  return root;
}
