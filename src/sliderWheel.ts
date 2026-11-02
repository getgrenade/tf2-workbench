/**
 * Every slider in the app (an input of type range) moves with the mouse wheel while the pointer is over it, or over the number box beside
 * it (a `.ui-val` row: a slider and its number): wheel up raises the value, wheel down lowers it, by one step per notch (Shift: ten steps).
 * A notch of a wheel is 100 of its delta; a touchpad sends many small ones, which add up to steps.
 * The slider reports the change like a drag does (input, then change), so everything that listens to a slider listens to the wheel: no
 * slider needs code of its own for it. (Ctrl + wheel is left to the page's zoom.)
 */

/** What each slider's wheel has moved that is not yet a whole step (a touchpad's small deltas). */
const carried = new WeakMap<HTMLInputElement, number>();

/** The slider a wheel over this element moves: the slider itself, or the one of the row whose number box it is. */
function sliderOf(target: Element | null): HTMLInputElement | null {
  const direct = target?.closest?.('input[type="range"]') as HTMLInputElement | null;
  if (direct) return direct;
  const box = target?.closest?.('input[type="number"]');
  return (box?.closest(".ui-val")?.querySelector('input[type="range"]') as HTMLInputElement | null) ?? null;
}

export function installSliderWheel() {
  window.addEventListener("wheel", (e) => {
    const slider = sliderOf(e.target as Element | null);
    if (!slider || slider.disabled || e.ctrlKey || !e.deltaY) return;
    e.preventDefault();
    // (a wheel that counts in lines says about 3 a notch; one in pixels, 100)
    const total = (carried.get(slider) ?? 0) + e.deltaY * (e.deltaMode === 1 ? 34 : 1);
    const notches = Math.trunc(total / 100);
    carried.set(slider, total - notches * 100);
    if (!notches) return;
    const min = Number(slider.min || 0), max = Number(slider.max || 100);
    const step = slider.step === "any" ? (max - min) / 100 : Number(slider.step) || 1;
    const before = Number(slider.value);
    slider.value = String(Math.max(min, Math.min(max, before - notches * step * (e.shiftKey ? 10 : 1))));
    // (the slider rounds to its step and clamps; a change that came to nothing says nothing)
    if (Number(slider.value) === before) return;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, { passive: false, capture: true });
}
