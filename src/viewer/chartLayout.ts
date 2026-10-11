/**
 * The layout of a paint chart: equal cells in rows, the last row centred, the whole grid centred in a picture of a fixed size (the
 * workshop's 16:9) and as large as fits. Pixels throughout.
 */

export interface ChartOptions {
  /** Size of the whole picture. */
  width: number;
  height: number;
  gapX: number;
  gapY: number;
  padding: number;
  /** Columns; 0 picks the count that makes the cells biggest. */
  cols: number;
}

export interface ChartLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  /** The rectangle of every item, in order. */
  rects: { x: number; y: number; w: number; h: number }[];
}

/** `cellAspect` is the width / height of one item's picture. */
export function layoutChart(count: number, cellAspect: number, o: ChartOptions): ChartLayout {
  const innerW = Math.max(1, o.width - 2 * o.padding);
  const innerH = Math.max(1, o.height - 2 * o.padding);
  const build = (cols: number): ChartLayout => {
    const rows = Math.ceil(count / cols);
    const byWidth = (innerW - (cols - 1) * o.gapX) / cols;
    const byHeight = ((innerH - (rows - 1) * o.gapY) / rows) * cellAspect;
    const cellW = Math.max(1, Math.min(byWidth, byHeight));
    const cellH = cellW / cellAspect;
    const gridH = rows * cellH + (rows - 1) * o.gapY;
    const top = (o.height - gridH) / 2;
    const rects: ChartLayout["rects"] = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, count - row * cols);
      const rowW = inRow * cellW + (inRow - 1) * o.gapX;
      rects.push({ x: (o.width - rowW) / 2 + (i - row * cols) * (cellW + o.gapX), y: top + row * (cellH + o.gapY), w: cellW, h: cellH });
    }
    return { cols, rows, cellW, cellH, width: o.width, height: o.height, rects };
  };
  if (count <= 0) return { cols: 0, rows: 0, cellW: 0, cellH: 0, width: o.width, height: o.height, rects: [] };
  if (o.cols > 0) return build(Math.min(o.cols, count));
  let best = build(1);
  for (let c = 2; c <= count; c++) {
    const layout = build(c);
    if (layout.cellW > best.cellW + 1e-9) best = layout;
  }
  return best;
}
