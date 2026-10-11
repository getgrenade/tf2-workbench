import { ICON_SAFE_ROWS } from "./tga";

/** How the bottom of the picture eases out: over `height` rows ending at the safe zone's last row, with the fall-off shaped by `curve`. */
export interface IconFade {
  height: number;
  /** 1 is a straight ramp; more keeps the picture solid longer and drops faster at the end; less drops early. */
  curve: number;
}

/** How much of the picture shows at `y` (0 to 1) for a fade: 1 above it, falling to 0 at the end of the safe zone. */
export function fadeAmount(y: number, fade: IconFade | null): number {
  if (!fade || fade.height <= 0) return 1;
  const height = Math.min(fade.height, ICON_SAFE_ROWS.end - ICON_SAFE_ROWS.start);
  const t = (ICON_SAFE_ROWS.end - y) / height; // 1 at the top of the fade, 0 at the end of the safe zone
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return Math.pow(t, fade.curve);
}

/**
 * Makes a 512x512 RGBA picture (top row first) fit the backpack icon rules: everything outside the safe rows is cut away, and with a
 * `fade` the bottom of the safe zone eases out instead of ending sharply (colour and alpha both, as the colour is over black). Edits the
 * pixels in place and returns how many visible pixels the cut took, so the caller can say the picture was too big.
 */
export function maskIcon(rgba: Uint8Array, fade: IconFade | null): number {
  let cut = 0;
  for (let y = 0; y < 512; y++) {
    const outside = y < ICON_SAFE_ROWS.start || y >= ICON_SAFE_ROWS.end;
    const k = outside ? 0 : fadeAmount(y, fade);
    if (k === 1) continue;
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      if (outside && rgba[i + 3] > 16) cut++;
      rgba[i] = Math.round(rgba[i] * k);
      rgba[i + 1] = Math.round(rgba[i + 1] * k);
      rgba[i + 2] = Math.round(rgba[i + 2] * k);
      rgba[i + 3] = Math.round(rgba[i + 3] * k);
    }
  }
  return cut;
}
