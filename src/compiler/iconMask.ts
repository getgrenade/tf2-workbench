import { ICON_SAFE_ROWS } from "./tga";

/** How one edge of the picture eases out: over `height` rows ending at that edge of the safe zone, with the fall-off shaped by `curve`. */
export interface IconFadeEdge {
  height: number;
  /** 1 is a straight ramp; more keeps the picture solid longer and drops faster at the end; less drops early. */
  curve: number;
}

/** The fades of the top and the bottom of the picture (null: that edge is cut sharply). */
export interface IconFade {
  top: IconFadeEdge | null;
  bottom: IconFadeEdge | null;
}

const SAFE_HEIGHT = ICON_SAFE_ROWS.end - ICON_SAFE_ROWS.start;

/** How much of an edge's fade is left `t` rows in from the edge (0 to 1). */
function edgeAmount(rowsIn: number, edge: IconFadeEdge | null): number {
  if (!edge || edge.height <= 0) return 1;
  const t = rowsIn / Math.min(edge.height, SAFE_HEIGHT); // 0 at the edge of the safe zone, 1 where the fade ends
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return Math.pow(t, edge.curve);
}

/** How much of the picture shows at row `y` (0 to 1) for the fades: 1 between them, falling to 0 at the edges of the safe zone. */
export function fadeAmount(y: number, fade: IconFade | null): number {
  if (!fade) return 1;
  return edgeAmount(ICON_SAFE_ROWS.end - y, fade.bottom) * edgeAmount(y + 1 - ICON_SAFE_ROWS.start, fade.top);
}

/**
 * Makes a 512x512 RGBA picture (top row first) fit the backpack icon rules: everything outside the safe rows is cut away, and with a
 * `fade` the top or bottom of the safe zone eases out instead of ending sharply (colour and alpha both, as the colour is over black).
 * Edits the pixels in place and returns how many visible pixels the cut took, so the caller can say the picture was too big.
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
