/**
 * Turns the `h3` headings of a block into foldable sections: everything after a heading, up to the next heading (or a tab strip),
 * moves into a body that the heading folds. The elements keep their identity, so ids and listeners are untouched. Which sections
 * are folded is remembered by `scope` + heading text.
 */
const STORAGE_KEY = "tf2workbench.folded";

function readFolded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

function writeFolded(folded: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...folded])); } catch { /* not remembered */ }
}

export function accordify(root: HTMLElement, scope: string) {
  const folded = readFolded();
  for (const head of Array.from(root.querySelectorAll<HTMLElement>(":scope > h3"))) {
    if (head.classList.contains("acc")) continue;
    const title = (head.childNodes[0]?.textContent ?? head.textContent ?? "").trim();
    const key = `${scope}:${title}`;
    // the heading's own text becomes the part that takes the free width, so its buttons stay at the right
    const text = document.createElement("span");
    text.className = "accTitle";
    while (head.firstChild && head.firstChild.nodeType === Node.TEXT_NODE) text.append(head.firstChild);
    head.prepend(text);
    const body = document.createElement("div");
    body.className = "accBody";
    let next = head.nextElementSibling;
    while (next && !next.matches("h3, .dockTabs")) {
      const after = next.nextElementSibling;
      body.append(next);
      next = after;
    }
    head.after(body);
    head.classList.add("acc");
    head.classList.toggle("closed", folded.has(key));
    head.onclick = (event) => {
      if ((event.target as HTMLElement).closest("button, input, select, a")) return;
      const closed = head.classList.toggle("closed");
      const now = readFolded();
      if (closed) now.add(key); else now.delete(key);
      writeFolded(now);
    };
  }
}
