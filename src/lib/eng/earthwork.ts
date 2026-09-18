/** Earthwork volumes by average end area and prismoidal formula; grid-method cut/fill. */

export function averageEndArea(areas: number[], distances: number[]) {
  if (areas.length !== distances.length + 1) throw new Error("distances must have one fewer entry than areas");
  let v = 0;
  const segs = [];
  for (let i = 0; i < distances.length; i++) {
    const s = ((areas[i] + areas[i + 1]) / 2) * distances[i];
    segs.push(s);
    v += s;
  }
  return { volume: v, segments: segs };
}

/** Prismoidal formula for equally spaced sections (odd number of areas). */
export function prismoidal(areas: number[], spacing: number) {
  if (areas.length < 3 || areas.length % 2 === 0) throw new Error("prismoidal formula needs an odd number (≥3) of equally spaced areas");
  let v = areas[0] + areas[areas.length - 1];
  for (let i = 1; i < areas.length - 1; i++) v += (i % 2 === 1 ? 4 : 2) * areas[i];
  return { volume: (spacing / 3) * v };
}

/** Grid method: existing and proposed levels at grid nodes (rows × cols), cell size in m. */
export function gridCutFill(existing: number[][], proposed: number[][], cellSize: number) {
  const rows = existing.length;
  const cols = existing[0].length;
  let cut = 0;
  let fill = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const diffs = [
        proposed[r][c] - existing[r][c],
        proposed[r][c + 1] - existing[r][c + 1],
        proposed[r + 1][c] - existing[r + 1][c],
        proposed[r + 1][c + 1] - existing[r + 1][c + 1],
      ];
      const avg = diffs.reduce((a, b) => a + b, 0) / 4;
      const vol = avg * cellSize * cellSize;
      if (vol > 0) fill += vol;
      else cut += -vol;
    }
  }
  return { cut, fill, net: fill - cut, note: "Positive net = import required (fill > cut)." };
}

/** Road/trench volume with side slopes: bottom width b, depth h, slope n (horizontal:1 vertical) */
export function trapezoidalSection(bottomWidth: number, depth: number, sideSlope: number, length: number) {
  const area = (bottomWidth + sideSlope * depth) * depth;
  return { area, topWidth: bottomWidth + 2 * sideSlope * depth, volume: area * length };
}
