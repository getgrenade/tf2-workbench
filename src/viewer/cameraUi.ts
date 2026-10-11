import * as THREE from "three";
import { CAMERA_RATIOS, FOV_MAX, FOV_MIN, cameraSize, cameraSizes, horizontalFov, verticalFov, type CameraRatio, type SceneCamera } from "./cameraData";
import type { CameraRig } from "./cameraRig";
import { attachNumberDrag } from "./numberDrag";
import { showContextMenu } from "./contextMenu";

export function createCameraUi(root: HTMLElement, getRig: () => CameraRig, prepare: () => void) {
  const axes = ["X", "Y", "Z"];
  const transforms = (kind: "position" | "rotation" | "scale", label: string) => `<fieldset><legend>${label}</legend>${axes.map(axis => `<label><span>${axis}</span><input data-field="${kind}-${axis}" type="number" step="${kind === "position" ? ".1" : "1"}" aria-label="Camera ${label.toLowerCase()} ${axis}" title="${kind === "rotation" ? 'Degrees (XYZ Euler rotation)' : 'World position (Source units)'}" /></label>`).join("")}</fieldset>`;
  root.innerHTML = `<h3 class="first">Cameras <button data-action="create" title="Add a camera from the current view">+ Add</button></h3>
    <div class="entList cameraList" data-list></div>
    <div class="cameraSettings"><label>Ratio <select data-field="ratio" aria-label="Camera ratio">${CAMERA_RATIOS.map(r => `<option>${r}</option>`).join("")}</select></label>
    <label>Output size <select data-field="size" aria-label="Camera output size"></select></label>
    <label class="cameraNumber" title="Horizontal field of view in degrees, as the view's own setting: drag to adjust, click to type">FOV <input data-field="fov" type="number" min="${FOV_MIN}" max="${FOV_MAX}" step="1" aria-label="Camera field of view" /></label></div>
    <div class="cameraTransforms"><div class="cameraTransformColumns">${transforms("position", "Location")}${transforms("rotation", "Rotation (°)")}${transforms("scale", "Scale").replace(/<input /g, '<input disabled title="A camera has no scale" ')}</div></div>
    <label class="cameraNavigation" title="Orbit, pan and zoom in camera view to update this camera"><input data-field="navigate" type="checkbox" /> Navigate camera view</label>
    <label class="cameraNavigation" title="A shot of this camera includes the sky or the colour behind the scene and the ground plane; off, they are left out"><input data-field="capture" type="checkbox" /> Capture background</label>
    <p class="dim hint" data-status>No cameras yet. Use + Add to create one from the current view.</p>`;
  const field = <T extends HTMLElement>(key: string) => root.querySelector<T>(`[data-field="${key}"]`)!;
  const list = root.querySelector<HTMLElement>("[data-list]")!, ratio = field<HTMLSelectElement>("ratio"), size = field<HTMLSelectElement>("size"), fov = field<HTMLInputElement>("fov");
  const location = axes.map(axis => field<HTMLInputElement>(`position-${axis}`)), rotation = axes.map(axis => field<HTMLInputElement>(`rotation-${axis}`));
  const navigate = field<HTMLInputElement>("navigate"), capture = field<HTMLInputElement>("capture");
  /** The aspect ratio (width / height) of the output frame of a camera: the field of view is shown as the horizontal one at it. */
  const aspectOf = (data: SceneCamera) => { const s = cameraSize(data); return s.w / s.h; };
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  let selected = "";
  let deselected = false;
  const rows = new Map<string, { row: HTMLDivElement; label: HTMLSpanElement; view: HTMLButtonElement; overlay: HTMLButtonElement; remove: HTMLButtonElement }>();
  const scrubbing = new Set<HTMLInputElement>();
  const setValue = (input: HTMLInputElement, value: string) => { if (!scrubbing.has(input) && document.activeElement !== input) input.value = value; };
  const render = () => {
    const rig = getRig();
    if (rig.active && deselected) { selected = rig.active; deselected = false; }
    if (!deselected && !rig.cameras.some(c => c.id === selected)) selected = rig.active ?? rig.cameras[0]?.id ?? "";
    for (const [id, entry] of rows) if (!rig.cameras.some(c => c.id === id)) { entry.row.remove(); rows.delete(id); }
    if (rig.cameras.length) list.querySelector("p")?.remove();
    rig.cameras.forEach((data, index) => {
      let entry = rows.get(data.id);
      if (!entry) {
      const row = document.createElement("div");
      const label = document.createElement("span"); label.className = "entName";
      const view = document.createElement("button"); view.title = "Show / hide camera transform gizmos (G / R; cameras have no scale)";
      view.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v14M1 8h14M8 1 6 3M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2"/></svg>';
      const overlay = document.createElement("button"); overlay.title = "Edit camera overlay: border, item icons and text";
      overlay.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="1.5" width="13" height="13" rx="1"/><path d="M4 5h8M8 5v7M5.5 12h5"/></svg>';
      const remove = document.createElement("button"); remove.className = "entX"; remove.textContent = "✕"; remove.title = "Delete camera"; remove.setAttribute("aria-label", `Delete ${data.name}`);
      const select = () => {
        if (rig.active === data.id) { selected = ""; deselected = true; rig.exit(); }
        else { selected = data.id; deselected = false; prepare(); rig.view(data.id); }
      };
      row.onclick = select;
      row.oncontextmenu = event => {
        event.preventDefault(); event.stopPropagation();
        selected = data.id; deselected = false; render();
        showContextMenu(event.clientX, event.clientY, [{ label: "Rename", run: () => {
          if (label.querySelector("input")) return;
          const camera = rig.cameras.find(c => c.id === data.id); if (!camera) return;
          const input = document.createElement("input"); input.value = camera.name;
          input.setAttribute("aria-label", "Camera name");
          let finished = false;
          const finish = (save: boolean) => {
            if (finished) return; finished = true;
            if (save && input.value.trim()) camera.name = input.value.trim();
            label.textContent = camera.name; rig.refresh();
          };
          input.onkeydown = key => {
            key.stopPropagation();
            if (key.key === "Enter") { key.preventDefault(); finish(true); }
            else if (key.key === "Escape") { key.preventDefault(); finish(false); }
          };
          input.onblur = () => finish(true);
          input.onclick = click => click.stopPropagation();
          input.onpointerdown = pointer => pointer.stopPropagation();
          label.replaceChildren(input); input.focus(); input.select();
        } }]);
      };
      view.onclick = event => {
        event.stopPropagation(); selected = data.id; deselected = false;
        if (rig.editing === data.id) rig.stopEditing();
        else { prepare(); rig.edit(data.id); }
      };
      remove.onclick = event => { event.stopPropagation(); rig.remove(data.id); };
      overlay.onclick = event => { event.stopPropagation(); selected = data.id; deselected = false; prepare(); rig.editOverlay(data.id); };
      row.append(label, view, overlay, remove); list.append(row);
      entry = { row, label, view, overlay, remove }; rows.set(data.id, entry);
      }
      entry.row.className = "ent" + (data.id === selected && (rig.active === data.id || rig.editing === data.id) ? " on" : "");
      if (!entry.label.querySelector("input")) entry.label.textContent = `${index + 1}  ${data.name}`;
      entry.label.title = `${data.name} (right-click to rename)`;
      entry.view.className = "entGizmo" + (rig.editing === data.id ? " on" : "");
      entry.view.setAttribute("aria-label", `Transform ${data.name}`); entry.view.setAttribute("aria-pressed", String(rig.editing === data.id));
      entry.overlay.className = "entGizmo" + (rig.overlayEditing === data.id ? " on" : "");
      entry.overlay.setAttribute("aria-label", `Edit overlay for ${data.name}`); entry.overlay.setAttribute("aria-pressed", String(rig.overlayEditing === data.id));
      entry.remove.setAttribute("aria-label", `Delete ${data.name}`);
      if (list.children[index] !== entry.row) list.insertBefore(entry.row, list.children[index] ?? null);
    });
    if (!rig.cameras.length && !list.querySelector("p")) { const empty = document.createElement("p"); empty.className = "dim hint"; empty.textContent = "No cameras yet."; list.append(empty); }
    const data = rig.cameras.find(c => c.id === selected);
    for (const input of [ratio, size, fov, navigate, capture, ...location, ...rotation]) input.disabled = !data;
    navigate.checked = data?.navigateView === true;
    capture.checked = data?.captureBackground === true;
    if (data) {
      ratio.value = data.ratio; setValue(fov, String(+horizontalFov(data.fov, aspectOf(data)).toFixed(2)));
      size.replaceChildren(...cameraSizes(data.ratio).map(s => new Option(`${s.w} × ${s.h}`, String(s.h)))); size.value = String(cameraSize(data).h);
      const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(data.quaternion), "XYZ");
      location.forEach((input, axis) => setValue(input, String(+data.position[axis].toFixed(4))));
      rotation.forEach((input, axis) => setValue(input, String(+THREE.MathUtils.radToDeg([euler.x, euler.y, euler.z][axis]).toFixed(4))));
    } else { for (const input of [fov, ...location, ...rotation]) input.value = ""; size.replaceChildren(); }
    status.textContent = !data ? "Use + Add to create a camera from the current view." : rig.active ? "Camera view active. Screenshots use its output size." : rig.editing ? "Drag the gizmo or edit the transforms below." : "Free view. Click a camera to view its shot.";
  };
  const bind = (action: string, fn: () => void) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.onclick = fn;
  bind("create", () => { deselected = false; prepare(); const rig = getRig(); selected = rig.fromView().id; render(); });
  navigate.onchange = () => getRig().setNavigateView(selected, navigate.checked);
  capture.onchange = () => getRig().setCaptureBackground(selected, capture.checked);
  ratio.onchange = () => { const rig = getRig(), data = rig.cameras.find(c => c.id === selected); if (data) { data.ratio = ratio.value as CameraRatio; data.height = cameraSizes(data.ratio)[0].h; rig.refresh(); } };
  size.onchange = () => { const rig = getRig(), data = rig.cameras.find(c => c.id === selected); if (data) { data.height = +size.value; rig.refresh(); } };
  fov.onchange = () => { const rig = getRig(), data = rig.cameras.find(c => c.id === selected); if (data) { data.fov = verticalFov(Math.max(FOV_MIN, Math.min(FOV_MAX, +fov.value || 30)), aspectOf(data)); rig.refresh(); } };
  let fovCameraId = "", startFov = 30, shownFov = 30;
  attachNumberDrag(fov, .25, {
    start() {
      fovCameraId = selected; shownFov = fov.valueAsNumber;
      const camera = getRig().cameras.find(camera => camera.id === fovCameraId);
      startFov = camera ? horizontalFov(camera.fov, aspectOf(camera)) : shownFov;
      scrubbing.add(fov);
    },
    change(value) {
      const rig = getRig(), camera = rig.cameras.find(camera => camera.id === fovCameraId);
      if (!camera) return;
      const shown = Math.max(FOV_MIN, Math.min(FOV_MAX, startFov + value - shownFov));
      camera.fov = verticalFov(shown, aspectOf(camera));
      fov.value = String(+shown.toFixed(2)); rig.refresh();
    },
    end() { scrubbing.delete(fov); render(); },
  });
  for (const [kind, inputs] of [["position", location], ["rotation", rotation]] as const) for (const input of inputs) {
    input.onchange = () => {
      if (inputs.some(field => !field.value.trim() || !Number.isFinite(field.valueAsNumber))) { render(); return; }
      getRig().setTransform(selected, { [kind]: inputs.map(field => field.valueAsNumber) as [number, number, number] });
    };
    input.onblur = render;
    let baseline: [number, number, number], cameraId = "";
    attachNumberDrag(input, kind === "position" ? .1 : .25, {
      start() {
        cameraId = selected;
        baseline = inputs.map(field => field.valueAsNumber) as [number, number, number];
        inputs.forEach(field => scrubbing.add(field));
      },
      change(value) {
        const values = [...baseline] as [number, number, number]; values[inputs.indexOf(input)] = value;
        getRig().setTransform(cameraId, { [kind]: values });
      },
      end() { inputs.forEach(field => scrubbing.delete(field)); render(); },
    });
  }
  fov.onblur = render;
  return Object.assign(render, {
    /** Makes the settings show this camera (the outliner picked it). */
    select(id: string) { selected = id; deselected = false; render(); },
  });
}
