/** A text box that holds a path shows the end of it (the name of the file) when it is not being edited, not the start (the drive and folders). */
export function endAligned(input: HTMLInputElement) {
  const toEnd = () => { if (document.activeElement !== input) input.scrollLeft = input.scrollWidth; };
  input.addEventListener("blur", toEnd);
  // once it is laid out, and each time its width changes (the panels are resized)
  new ResizeObserver(toEnd).observe(input);
}
