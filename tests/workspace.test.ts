// Run with: npm test -- workspace
import assert from "node:assert/strict";
import { test } from "node:test";
import { PANEL_DEFS, SIMPLIFIED_PANELS, defaultLayout, simplifiedLayout } from "../src/dock/defaultLayout.ts";
import { parseLayout } from "../src/dock/dockModel.ts";
import { decodeWorkspace, encodeWorkspace } from "../src/dock/workspaceFile.ts";

const ids = PANEL_DEFS.map((d) => d.id);
const shown = (l: ReturnType<typeof defaultLayout>) => Object.values(l.docks).flatMap((d) => d.groups.flatMap((g) => g.tabs));

test("the simplified layout keeps the main panels and puts the others away, as the docks read it", () => {
  const l = parseLayout(simplifiedLayout(), ids, defaultLayout());
  assert.deepEqual(new Set(shown(l)), new Set(SIMPLIFIED_PANELS));
  for (const away of ["particles", "post", "overlay", "flex", "poses", "props", "lightsetups"]) assert.ok(l.hidden.includes(away), away);
});

test("a workspace file gives back the layout it was saved with, and nothing else is taken for one", () => {
  const layout = defaultLayout();
  assert.deepEqual(decodeWorkspace(encodeWorkspace(layout)), layout);
  assert.throws(() => decodeWorkspace("{\"characters\": []}"));
  assert.throws(() => decodeWorkspace("not json"));
});
