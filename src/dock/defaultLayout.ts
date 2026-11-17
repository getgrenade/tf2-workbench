import { emptyLayout, type DockLayout } from "./dockModel";

/** The panels that can be moved about: id, title on the tab, and the id of the element that is the panel. */
export const PANEL_DEFS: { id: string; title: string; element: string }[] = [
  { id: "outliner", title: "Outliner", element: "panelOutliner" },
  { id: "overlay", title: "Overlay", element: "overlayPane" },
  { id: "properties", title: "Properties", element: "panelProperties" },
  { id: "textures", title: "Textures", element: "panelTextures" },
  { id: "cosmetics", title: "Cosmetics", element: "cosmeticsPane" },
  { id: "weapons", title: "Weapons", element: "weaponsPane" },
  { id: "animation", title: "Animation", element: "animPane" },
  { id: "flex", title: "Flex", element: "flexPane" },
  { id: "poses", title: "Pose Library", element: "posePane" },
  { id: "lighting", title: "World", element: "lightPane" },
  { id: "lightsetups", title: "Light", element: "lightSetupsPane" },
  { id: "post", title: "Post-processing", element: "postPane" },
  { id: "particles", title: "Particles", element: "particlesPane" },
  { id: "props", title: "Props", element: "propsPane" },
];

/** The layout the program starts with, and what "Reset layout" goes back to. */
export function defaultLayout({ props = true }: { props?: boolean } = {}): DockLayout {
  const l = emptyLayout();
  l.docks.left.groups = [
    { tabs: ["outliner"], active: "outliner", weight: 0.73 },
    { tabs: ["properties"], active: "properties", weight: 1.33 },
    { tabs: ["lighting", "lightsetups", "textures"], active: "lighting", weight: 0.94 },
  ];
  l.docks.right.groups = [
    { tabs: ["cosmetics"], active: "cosmetics", weight: 1.34 },
    { tabs: props ? ["weapons", "props"] : ["weapons"], active: "weapons", weight: 0.66 },
  ];
  l.docks.bottom.groups = [
    { tabs: ["animation", "flex", "poses"], active: "flex", weight: 1.8 },
    { tabs: ["particles"], active: "particles", weight: 0.72 },
    { tabs: ["post", "overlay"], active: "post", weight: 0.48 },
  ];
  for (const dock of ["left", "right", "bottom"] as const) for (const g of l.docks[dock].groups) for (const id of g.tabs) l.lastDock[id] = dock;
  return l;
}

/** The panels the simplified layout keeps: the character, what it wears and holds, its animation, its textures and the world's light. */
export const SIMPLIFIED_PANELS = ["outliner", "properties", "textures", "lighting", "cosmetics", "weapons", "animation"];

/**
 * A simplified layout for posing and dressing: the default one without the particles, post-processing, overlay and the extra windows (flex,
 * pose library, light setups, props). Every panel it leaves out can be brought back from the Layout menu.
 */
export function simplifiedLayout(): DockLayout {
  const l = defaultLayout({ props: true });
  const keep = new Set(SIMPLIFIED_PANELS);
  for (const dock of ["left", "right", "bottom"] as const) {
    // (the panels left out are put away, not lost: they come back where they were from the Layout menu)
    for (const g of l.docks[dock].groups) for (const id of g.tabs) if (!keep.has(id)) l.hidden.push(id);
    l.docks[dock].groups = l.docks[dock].groups
      .map((g) => {
        const tabs = g.tabs.filter((t) => keep.has(t));
        return { ...g, tabs, active: tabs.includes(g.active) ? g.active : tabs[0] };
      })
      .filter((g) => g.tabs.length > 0);
  }
  return l;
}
