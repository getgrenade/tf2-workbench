/**
 * The Overlay panel: the things of the overlay of the camera that is looked through (its border, a picture behind the scene, the icons,
 * pictures and texts), as a list like the outliner's, simplified. The list is the order they are drawn in, the one on top in front: drag an
 * element to put it somewhere else (the border is always in front, the background picture always behind). The one that is picked has its
 * settings in the Properties panel and is marked in the frame.
 */
import { icon as svgIcon, type IconName } from "../icons";
import { showContextMenu } from "./contextMenu";
import { itemIcon } from "./itemIcons";
import { attachNumberDrag } from "./numberDrag";
import { openMenu } from "./popMenu";
import type { CameraOverlay, OverlayEntryKind } from "./cameraOverlay";

const ICONS: Record<OverlayEntryKind, IconName> = { border: "frame", background: "wallpaper", image: "image", icon: "star", text: "type" };
/** The entries that are elements, and so can be dragged to another place in the order. */
const MOVABLE = new Set<OverlayEntryKind>(["icon", "image", "text"]);

export function createOverlayPanel(options: {
  list: HTMLElement; add: HTMLButtonElement; edit: HTMLButtonElement; hint: HTMLElement; grid: HTMLElement;
  overlay: () => CameraOverlay | null;
  /** A camera is being looked through (its overlay can be edited). */
  cameraActive: () => boolean;
  /** Starts or ends the editing of the overlay of the camera that is looked through. */
  toggle: () => void;
}) {
  const { list, add, edit, hint, grid } = options;
  edit.onclick = () => options.toggle();

  grid.innerHTML = `<label title="Icons, texts and pictures land on the lines of the grid; Alt goes round it"><input type="checkbox" data-grid="enabled" /> Snap</label>
<label><input type="checkbox" data-grid="show" /> Show grid</label>
<label title="The size of a cell of the grid, in percent of the height of the frame">Grid <input type="number" data-grid="size" min="1" max="20" step=".5" /> %</label>`;
  const gridInput = (key: string) => grid.querySelector<HTMLInputElement>(`[data-grid="${key}"]`)!;
  const apply = () => {
    const overlay = options.overlay(); if (!overlay?.isEditing) return;
    const size = gridInput("size").valueAsNumber / 100;
    overlay.setGrid({ enabled: gridInput("enabled").checked, show: gridInput("show").checked, ...(Number.isFinite(size) ? { size } : {}) });
  };
  for (const key of ["enabled", "show", "size"]) gridInput(key).oninput = apply;
  // the size of the grid is typed or scrubbed
  const sizeInput = gridInput("size");
  sizeInput.closest("label")!.classList.add("scrubRow");
  attachNumberDrag(sizeInput, .05, { start() {}, change: value => { sizeInput.value = String(+Math.max(1, Math.min(20, value)).toFixed(1)); apply(); }, end() {} });

  /** The id of the element that is being dragged in the list. */
  let dragging: string | null = null;
  const clearMarks = () => { for (const row of list.querySelectorAll(".dropAbove, .dropBelow")) row.classList.remove("dropAbove", "dropBelow"); };

  function refresh() {
    const overlay = options.overlay();
    const editing = !!overlay?.isEditing;
    const through = options.cameraActive();
    edit.disabled = !through;
    edit.classList.toggle("on", editing);
    edit.textContent = editing ? "Done" : "Edit";
    edit.title = editing ? "Stop editing the overlay" : through ? "Edit the overlay of the camera that is looked through" : "Look through a camera to edit its overlay";
    add.disabled = !editing;
    grid.hidden = !editing;
    list.replaceChildren();
    hint.textContent = editing ? overlay!.hint : "";
    hint.classList.toggle("placing", editing && !!overlay!.placing);
    if (!editing) {
      const empty = document.createElement("div");
      empty.className = "hierEmpty";
      empty.textContent = through ? "Press Edit to edit the overlay of this camera: a border, a picture behind the scene, icons, pictures and text." : "Look through a camera (the camera button in the view), then press Edit to edit its overlay.";
      list.append(empty);
      return;
    }
    const g = overlay!.getGrid();
    gridInput("enabled").checked = g.enabled; gridInput("show").checked = g.show;
    if (document.activeElement !== gridInput("size")) gridInput("size").value = String(+(g.size * 100).toFixed(1));
    const entries = overlay!.entries();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "hierEmpty";
      empty.textContent = "Nothing in the overlay yet. Add a border, a picture, an icon or a text with + Add.";
      list.append(empty);
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      const selected = overlay!.selection === entry.id;
      row.className = "hierRow hierObject" + (selected ? " selected primary" : "");
      row.dataset.overlay = entry.id;
      const icon = document.createElement("span");
      icon.className = "hierIcon";
      icon.innerHTML = svgIcon(ICONS[entry.kind]);
      if (entry.image) {
        // an icon of an item shows its own picture
        const image = document.createElement("img");
        image.alt = ""; image.style.cssText = "width:16px;height:16px;object-fit:contain";
        void itemIcon(entry.image).then((url) => { if (url) { image.src = url; icon.replaceChildren(image); } });
      }
      const label = document.createElement("span");
      label.className = "hierLabel";
      label.textContent = entry.label;
      const kind = document.createElement("span");
      kind.className = "hierCount";
      kind.textContent = entry.kind;
      const remove = document.createElement("button");
      remove.className = "hierTool hierRemove";
      remove.title = `Remove ${entry.label}`;
      remove.innerHTML = svgIcon("x");
      remove.onclick = (e) => { e.stopPropagation(); overlay!.remove(entry.id); };
      row.append(icon, label, kind, remove);
      row.onclick = () => overlay!.select(entry.id);
      // a right click picks the entry and offers to copy it (Ctrl+C), paste what was copied (Ctrl+V) and remove it
      row.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        overlay!.select(entry.id);
        showContextMenu(e.clientX, e.clientY, [
          { label: "Copy", run: () => overlay!.copy(), disabled: !MOVABLE.has(entry.kind) },
          { label: "Paste", run: () => overlay!.paste(), disabled: !overlay!.canPaste },
          { label: "Remove", run: () => overlay!.remove(entry.id) },
        ]);
      };

      // the order of the list is the order of drawing: an element is dragged over the row it should go above or below
      if (MOVABLE.has(entry.kind)) {
        row.draggable = true;
        row.ondragstart = (e) => { dragging = entry.id; e.dataTransfer?.setData("text/plain", entry.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
        row.ondragend = () => { dragging = null; clearMarks(); };
      }
      row.ondragover = (e) => {
        if (!dragging || dragging === entry.id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        const r = row.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2;
        clearMarks();
        // above the border or below the background are the ends of the order; the border and the picture themselves stay where they are
        row.classList.add(above ? "dropAbove" : "dropBelow");
      };
      row.ondrop = (e) => {
        if (!dragging || dragging === entry.id) return;
        e.preventDefault();
        const r = row.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2, id = dragging;
        dragging = null; clearMarks();
        if (entry.kind === "border") overlay!.moveElementTo(id, "front");
        else if (entry.kind === "background") overlay!.moveElementTo(id, "back");
        else overlay!.moveElement(id, entry.id, above);
      };
      list.append(row);
    }
  }

  // a right click on the empty part of the list can only paste
  list.oncontextmenu = (e) => {
    const overlay = options.overlay(); if (!overlay?.isEditing || (e.target as HTMLElement).closest(".hierRow")) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [{ label: "Paste", run: () => overlay.paste(), disabled: !overlay.canPaste }]);
  };

  add.onclick = () => {
    const overlay = options.overlay(); if (!overlay?.isEditing) return;
    const icons = [...new Map(overlay.items().map((item) => [item.image, item])).values()];
    openMenu(add, [
      { label: "Border", icon: ICONS.border, run: () => overlay.addBorder() },
      { label: "Background picture…", icon: ICONS.background, hint: "behind the scene", run: () => overlay.chooseBackground() },
      { label: "Image…", icon: ICONS.image, hint: "from disk", separator: true, run: () => overlay.chooseImage() },
      {
        label: "Icon",
        icon: ICONS.icon,
        children: icons.length ? icons.map((item) => ({ label: item.label, run: () => overlay.placeIcon(item) })) : [{ label: "Equip a cosmetic or a taunt first", disabled: true }],
      },
      { label: "Text", icon: ICONS.text, run: () => overlay.placeText() },
    ]);
  };

  refresh();
  return { refresh };
}
