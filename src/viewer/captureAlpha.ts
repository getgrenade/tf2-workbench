/** The capture shader outputs display-space RGB over black plus surface coverage.
 * PNG requires straight colour: choose coverage sufficient for the emitted light, then divide it out.
 * This preserves the rendered appearance over black and avoids opaque black additive sprite cards.
 */
export function resolveCaptureEmission(pixels: Uint8Array): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const coverage = Math.max(pixels[i + 3], pixels[i], pixels[i + 1], pixels[i + 2]);
    if (!coverage) continue;
    pixels[i] = Math.round(pixels[i] * 255 / coverage);
    pixels[i + 1] = Math.round(pixels[i + 1] * 255 / coverage);
    pixels[i + 2] = Math.round(pixels[i + 2] * 255 / coverage);
    pixels[i + 3] = coverage;
  }
}
