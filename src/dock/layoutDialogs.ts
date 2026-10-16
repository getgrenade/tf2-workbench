/** Small modal questions of the Layout menu (the webview has no dialogs of its own that suit the interface): a name, and a yes / no. */

function modal(build: (card: HTMLElement, done: (value: unknown) => void) => HTMLElement | null): Promise<unknown> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "uiModalBack";
    const card = document.createElement("div");
    card.className = "uiModal";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    back.append(card);
    const previous = document.activeElement as HTMLElement | null;
    let closed = false;
    const done = (value: unknown) => {
      if (closed) return;
      closed = true;
      window.removeEventListener("keydown", onKey, true);
      back.remove();
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
    };
    const focus = build(card, done);
    window.addEventListener("keydown", onKey, true);
    // a click outside the card is a no
    back.onpointerdown = (e) => { if (e.target === back) done(null); };
    document.body.append(back);
    focus?.focus();
  });
}

const button = (text: string, className: string, click: () => void) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.onclick = click;
  return b;
};

/** Asks for a name. Resolves with it (not empty, trimmed by the caller), or null when the question was dismissed. */
export function askName(options: { title: string; label: string; value?: string; ok: string; max?: number }): Promise<string | null> {
  return modal((card, done) => {
    const title = document.createElement("h3");
    title.textContent = options.title;
    const label = document.createElement("label");
    label.textContent = options.label;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "text";
    input.value = options.value ?? "";
    input.maxLength = options.max ?? 40;
    input.spellcheck = false;
    label.append(input);
    const ok = button(options.ok, "primary", () => { if (input.value.trim()) done(input.value); });
    const cancel = button("Cancel", "", () => done(null));
    const sync = () => { ok.disabled = !input.value.trim(); };
    input.oninput = sync;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } };
    sync();
    const row = document.createElement("div");
    row.className = "uiModalButtons";
    row.append(cancel, ok);
    card.append(title, label, row);
    queueMicrotask(() => input.select());
    return input;
  }).then((v) => (typeof v === "string" ? v : null));
}

/** Asks yes or no. Resolves true on the confirming button only; Escape, a click outside and Cancel are a no. */
export function askConfirm(options: { title: string; message: string; ok: string; danger?: boolean }): Promise<boolean> {
  return modal((card, done) => {
    const title = document.createElement("h3");
    title.textContent = options.title;
    const text = document.createElement("p");
    text.textContent = options.message;
    const cancel = button("Cancel", "", () => done(false));
    const ok = button(options.ok, options.danger ? "danger" : "primary", () => done(true));
    const row = document.createElement("div");
    row.className = "uiModalButtons";
    row.append(cancel, ok);
    card.append(title, text, row);
    // the safe answer has the focus: Enter does not delete by accident
    return cancel;
  }).then((v) => v === true);
}
