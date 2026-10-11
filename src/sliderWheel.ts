/**
 * Every slider in the app (an input of type range) moves with the mouse wheel while the pointer is over it: wheel up raises the value,
 * wheel down lowers it, by one step per notch (Shift: ten steps).
 * The slider reports the change like a drag does (input, then change), so everything that listens to a slider listens to the wheel.
 */
export function installSliderWheel() {
  window.addEventListener("wheel", (e) => {
    const slider = (e.target as Element | null)?.closest?.('input[type="range"]') as HTMLInputElement | null;
    // (a slider that has a wheel handler of its own, the compiler's, keeps it)
    if (!slider || slider.disabled || e.ctrlKey || !e.deltaY || slider.closest(".ui-val")) return;
    e.preventDefault();
    const min = Number(slider.min || 0), max = Number(slider.max || 100);
    const step = slider.step === "any" ? (max - min) / 100 : Number(slider.step) || 1;
    const before = Number(slider.value);
    const moves = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1);
    slider.value = String(Math.max(min, Math.min(max, before + moves * step)));
    // (the slider rounds to its step and clamps; a change that came to nothing says nothing)
    if (Number(slider.value) === before) return;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, { passive: false, capture: true });
}
