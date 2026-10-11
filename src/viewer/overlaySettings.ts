/**
 * The settings of the view's overlay buttons (the wireframe, the floor grid, the selection outline and the light indicators), in the panel
 * that the arrow at the end of that group opens: the colours and opacities of what they draw. They used to be in the Settings tab.
 */
import { DEFAULTS, onSettingsChange, settings, updateSetting, updateSettings } from "../settingsStore";
import type { Settings } from "../api";
import { togglePopover } from "./viewPopover";

/** One line of the panel: a name, a colour and (for most) an opacity. */
interface Row {
  label: string;
  title: string;
  color: "wireColor" | "gridColor" | "flashColor";
  opacity: "wireOpacity" | "gridOpacity" | "selectionOpacity";
}

const ROWS: Row[] = [
  { label: "Wireframe", title: "The edges drawn over the model in wireframe mode", color: "wireColor", opacity: "wireOpacity" },
  { label: "Floor grid", title: "The grid on the floor (the opacity is that of its stronger lines; the thin ones are about half of it)", color: "gridColor", opacity: "gridOpacity" },
  { label: "Selection", title: "The outline around what is selected, and the glow when you click something in the view (its strength follows the opacity)", color: "flashColor", opacity: "selectionOpacity" },
];

export function openOverlaySettings(anchor: HTMLElement) {
  togglePopover(anchor, "Viewport Overlays", (body, head) => {
    const syncers: (() => void)[] = [];
    const save = (key: keyof Settings, value: string | number) => { void updateSetting(key, value as never); };
    for (const row of ROWS) {
      const line = document.createElement("label");
      line.className = "viewPopoverRow";
      line.title = row.title;
      const name = document.createElement("span");
      name.textContent = row.label;
      const picker = document.createElement("input");
      picker.type = "color";
      picker.setAttribute("aria-label", `${row.label}: colour`);
      // the same slider as the rest of the interface (the ones of the flex and the animation panels)
      const slider = document.createElement("input");
      slider.type = "range"; slider.className = "ui-range"; slider.min = "0"; slider.max = "1"; slider.step = "0.01";
      slider.setAttribute("aria-label", `${row.label}: opacity`);
      const out = document.createElement("output");
      const show = () => { out.textContent = `${Math.round(Number(slider.value) * 100)}%`; };
      picker.oninput = () => save(row.color, picker.value);
      slider.oninput = () => { show(); save(row.opacity, Number(slider.value)); };
      syncers.push(() => { picker.value = String(settings()[row.color]); slider.value = String(settings()[row.opacity]); show(); });
      line.append(name, picker, slider, out);
      body.append(line);
    }
    // the reset sits in the title line, at the right
    const reset = document.createElement("button");
    reset.className = "viewPopoverReset";
    reset.textContent = "Reset colours";
    reset.title = "Back to the default colours";
    reset.onclick = async () => {
      const back: Partial<Settings> = {};
      for (const r of ROWS) Object.assign(back, { [r.color]: DEFAULTS[r.color], [r.opacity]: DEFAULTS[r.opacity] });
      await updateSettings(back);
      syncers.forEach((f) => f());
    };
    head.append(reset);
    syncers.forEach((f) => f());
    // a change from somewhere else (the settings are shared) shows here too, while the panel is open
    const stop = onSettingsChange(() => { if (!body.isConnected) stop(); else syncers.forEach((f) => f()); });
  });
}
