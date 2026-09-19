/**
 * Reinforcing bar catalogues. Metric bars (Ø8–Ø32, area πd²/4) as used in Bangladesh and India; US inch-pound bars
 * #3–#11 per ASTM A615/A706 with their nominal diameters and nominal areas (0.11, 0.20, 0.31, 0.44, 0.60, 0.79, 1.00,
 * 1.27, 1.56 in²), which are the areas ACI 318 design uses (not πd²/4). Engines work in mm and mm²; a bar is identified
 * by its nominal diameter in mm.
 */
export type BarSystem = "metric" | "US";

export interface UsBar { no: number; d: number; A: number; in2: number; dIn: number }
const IN = 25.4;
/** ASTM A615 Table 1: bar number, nominal diameter (in), nominal area (in²). */
export const US_BARS: UsBar[] = ([[3, 0.375, 0.11], [4, 0.5, 0.2], [5, 0.625, 0.31], [6, 0.75, 0.44], [7, 0.875, 0.6], [8, 1.0, 0.79], [9, 1.128, 1.0], [10, 1.27, 1.27], [11, 1.41, 1.56]] as const)
  .map(([no, dIn, in2]) => ({ no, dIn, in2, d: dIn * IN, A: in2 * IN * IN }));
export const METRIC_BARS = [8, 10, 12, 16, 20, 22, 25, 28, 32];

/** US bar by number (3–11) or by a diameter in mm (nearest bar). */
export function usBar(noOrMm: number): UsBar {
  const byNo = US_BARS.find((b) => b.no === noOrMm && Number.isInteger(noOrMm));
  if (byNo && noOrMm <= 11) return byNo;
  return US_BARS.reduce((best, b) => (Math.abs(b.d - noOrMm) < Math.abs(best.d - noOrMm) ? b : best), US_BARS[0]);
}
/** Diameter (mm) of a bar given as mm (metric) or, for US bars, as a bar number 3–11 or a diameter in mm. */
export const barDia = (v: number, sys: BarSystem = "metric") => (sys === "US" ? usBar(v).d : v);
export const areaOf = (d: number, sys: BarSystem = "metric") => (sys === "US" ? usBar(d).A : (Math.PI * d * d) / 4);
export const nameOf = (d: number, sys: BarSystem = "metric") => (sys === "US" ? `#${usBar(d).no}` : `Ø${d}`);
/** Label with size: "Ø16 mm" or "#5". */
export const sizeLabel = (d: number, sys: BarSystem = "metric") => (sys === "US" ? `#${usBar(d).no}` : `Ø${d} mm`);
/** Candidate main-bar sizes for flexure and columns. */
export const mainBarSizes = (sys: BarSystem = "metric") => (sys === "US" ? US_BARS.filter((b) => b.no >= 4).map((b) => b.d) : [12, 16, 20, 22, 25, 28, 32]);
export const columnBarSizes = (sys: BarSystem = "metric") => (sys === "US" ? US_BARS.filter((b) => b.no >= 5).map((b) => b.d) : [12, 16, 20, 22, 25, 28, 32]);
