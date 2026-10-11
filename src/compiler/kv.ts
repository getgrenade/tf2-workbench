/**
 * Valve KeyValues text, as far as the importer's material files use it: quoted or bare tokens, nested blocks, `//` comments. A tree of
 * ordered nodes (keys may repeat) that prints back in the style KeyValues::SaveToFile writes, which is what the game's files look like.
 */
export interface KvNode {
  key: string;
  /** A leaf's value. */
  value?: string;
  /** A block's children. */
  children?: KvNode[];
}

export class KvError extends Error {}

export function parseKv(text: string): KvNode[] {
  let i = 0;
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) { while (i < text.length && text[i] !== "\n") i++; continue; }
      return;
    }
  };
  const token = (): string | null => {
    skip();
    if (i >= text.length) return null;
    if (text[i] === '"') {
      let out = "";
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length) { out += text[i + 1] === "n" ? "\n" : text[i + 1] === "t" ? "\t" : text[i + 1]; i += 2; } else out += text[i++];
      }
      if (i >= text.length) throw new KvError("A quoted string is not closed");
      i++;
      return out;
    }
    if (text[i] === "{" || text[i] === "}") return text[i++];
    const start = i;
    while (i < text.length && !/[\s{}"]/.test(text[i])) i++;
    return text.slice(start, i);
  };
  const block = (top: boolean): KvNode[] => {
    const nodes: KvNode[] = [];
    for (;;) {
      const key = token();
      if (key === null) { if (top) return nodes; throw new KvError("A block is not closed"); }
      if (key === "}") { if (top) throw new KvError("Unexpected }"); return nodes; }
      if (key === "{") throw new KvError("Unexpected {");
      const next = token();
      if (next === null) throw new KvError(`"${key}" has no value`);
      if (next === "{") nodes.push({ key, children: block(false) });
      else if (next === "}") throw new KvError(`"${key}" has no value`);
      else nodes.push({ key, value: next });
    }
  };
  return block(true);
}

/** The node at a `/`-separated path of keys (case-insensitive), or undefined. */
export function findKv(nodes: KvNode[], path: string): KvNode | undefined {
  let list: KvNode[] | undefined = nodes, found: KvNode | undefined;
  for (const part of path.split("/")) {
    found = list?.find((n) => n.key.toLowerCase() === part.toLowerCase());
    list = found?.children;
  }
  return found;
}

export function getKv(nodes: KvNode[], path: string, fallback = ""): string {
  return findKv(nodes, path)?.value ?? fallback;
}

export function setKv(nodes: KvNode[], key: string, value: string) {
  const existing = nodes.find((n) => n.key.toLowerCase() === key.toLowerCase() && n.value !== undefined);
  if (existing) existing.value = value; else nodes.push({ key, value });
}

export function removeKv(nodes: KvNode[], key: string) {
  const at = nodes.findIndex((n) => n.key.toLowerCase() === key.toLowerCase());
  if (at >= 0) nodes.splice(at, 1);
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The text KeyValues writes: each key and value quoted, two tabs between them, blocks on their own lines. Like KeyValues, a leaf with an
 * empty value is not written at all (and a block always is: the importer relies on that to emit an empty `invis` proxy).
 */
export function printKv(nodes: KvNode[], depth = 0): string {
  const pad = "\t".repeat(depth);
  let out = "";
  for (const n of nodes) {
    if (n.children) out += `${pad}${quote(n.key)}\n${pad}{\n${printKv(n.children, depth + 1)}${pad}}\n`;
    else if (n.value !== undefined && n.value !== "") out += `${pad}${quote(n.key)}\t\t${quote(n.value)}\n`;
  }
  return out;
}

export function cloneKv(nodes: KvNode[]): KvNode[] {
  return nodes.map((n) => (n.children ? { key: n.key, children: cloneKv(n.children) } : { key: n.key, value: n.value }));
}
