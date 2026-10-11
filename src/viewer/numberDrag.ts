/** Click to type; drag horizontally to scrub. Shift makes movement ten times finer. */
export function attachNumberDrag(input: HTMLInputElement, sensitivity: number, edit: { start(): void; change(value: number): void; end(): void }) {
  const row = input.closest("label")!;
  let drag: { pointer: number; x: number; value: number; started: boolean } | null = null;
  let suppressClick = false;
  const finish = (cancel: boolean) => {
    if (!drag) return;
    const previous = drag; drag = null;
    if (row.hasPointerCapture(previous.pointer)) row.releasePointerCapture(previous.pointer);
    row.classList.remove("scrubbing");
    if (previous.started) {
      suppressClick = true;
      if (cancel) { input.value = String(previous.value); edit.change(previous.value); }
      edit.end();
    } else if (!cancel) { input.focus(); input.select(); }
  };
  row.addEventListener("pointerdown", event => {
    if (event.button !== 0 || input.disabled || (event.target === input && document.activeElement === input)) return;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    event.preventDefault();
    drag = { pointer: event.pointerId, x: event.clientX, value, started: false };
    suppressClick = false;
    row.setPointerCapture(event.pointerId);
  });
  row.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const delta = event.clientX - drag.x;
    if (!drag.started && Math.abs(delta) < 3) return;
    if (!drag.started) { drag.started = true; edit.start(); row.classList.add("scrubbing"); }
    event.preventDefault();
    const value = +(drag.value + delta * sensitivity * (event.shiftKey ? .1 : 1)).toFixed(4);
    input.value = String(value); edit.change(value);
  });
  row.addEventListener("pointerup", event => { if (event.pointerId === drag?.pointer) finish(false); });
  row.addEventListener("pointercancel", () => finish(true));
  row.addEventListener("lostpointercapture", () => finish(true));
  row.addEventListener("click", event => { if (suppressClick) { event.preventDefault(); suppressClick = false; } }, true);
  window.addEventListener("keydown", event => {
    if (drag?.started && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(true); }
  }, true);
}
