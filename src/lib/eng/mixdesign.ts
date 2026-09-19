/**
 * Concrete mix design: proportioning by mass for a target strength (not nominal volume mixes such as 1:2:4, see quantity.ts).
 *
 * Sources (tables transcribed from the primary documents):
 *  - ACI 211.1-91 (Reapproved 2009), "Standard Practice for Selecting Proportions for Normal, Heavyweight, and Mass
 *    Concrete". SI: Appendix 1 Tables A1.5.3.1 (slump), A1.5.3.3 (water and air), A1.5.3.4(a) (w/c vs strength),
 *    A1.5.3.4(b) (w/c for severe exposure), A1.5.3.6 (coarse aggregate volume), A1.5.3.7.1 (fresh concrete mass).
 *    Inch-pound: Tables 6.3.1, 6.3.3, 6.3.4(a), 6.3.6 and 6.3.7.1 (these differ slightly from the SI tables, so US inputs
 *    use them directly). Worked examples: Sec. 7.2 and 7.3 (inch-pound) and Appendix 2 (SI).
 *    Basis: coarse aggregate from the oven-dry-rodded volume, so aggregate masses are oven-dry and the specific gravities
 *    must be bulk oven-dry (ACI 211.1 Sec. 6.3.7.1 footnote); SSD and field (moist) batches are derived from them.
 *  - PCA EB001 "Design and Control of Concrete Mixtures", Table 9-3: w/c rows beyond ACI 211.1 (45 MPa 0.38/0.30 and
 *    40 MPa air-entrained 0.34; 7000 psi 0.33 and 6000 psi air-entrained 0.32). Used only above the ACI table and flagged.
 *  - Required average strength f'cr: ACI 318M-08 Sec. 5.3 (Tables 5.3.1.2, 5.3.2.1, 5.3.2.2; the same values are in
 *    ACI 301 for ACI 318-14/19) and the inch-pound equivalents; BNBC 2020 Part 6 Ch. 5 Sec. 5.6.2 (Tables 6.5.4, 6.5.5).
 *  - BNBC 2020 durability: Part 6 Ch. 5 Sec. 5.5.1 (low permeability, brackish/sea water), Table 6.5.2 (sulphate),
 *    Sec. 5.5.4 (minimum strength), Sec. 5.6.3 Table 6.5.6 (w/c without field or trial data); Ch. 8 Sec. 8.1.7 Table 6.8.3
 *    and Sec. 8.1.7.8 (corrosive environments); Ch. 3 tremie piles (minimum cement 350/400 kg/m³).
 *  - IS 10262:2019 Section 2 (grades up to M60): Tables 1 to 5, cl. 5.1 to 5.7 and Annex A; durability from IS 456:2000
 *    Table 5 (with Table 6 adjustment for aggregate size) and cl. 8.2.4.2 (maximum cement 450 kg/m³).
 *    IS 10262 Fig. 1 has curves only, no equation: the w/c-strength points below are an approximate digitisation (±1 MPa),
 *    NOT published values. Always confirm the w/c by trial mixes, or pass a w/c from trials (wcOverride).
 *
 * Units: SI internally (MPa, mm, kg/m³, m³). US inputs (psi, in., lb/ft³) are converted; US outputs are in lb/yd³
 * (1 kg/m³ = 1.6856 lb/yd³). Water density 1000 kg/m³ (SI) or 62.4 lb/ft³ (inch-pound, as in ACI 211.1 Chapter 7).
 * Rounding: water to the nearest kg (lb), cement up to the next kg (lb), w/c from the strength tables down to 0.01, as in the
 * ACI 211.1 and IS 10262 worked examples.
 *
 * Results are starting proportions for trial batches, not a final mix (ACI 211.1 Sec. 6.3.9, BNBC 5.6.2.3, IS 10262 cl. 5.8).
 */
import { CEMENT_BAG_KG, CFT_PER_M3 } from "./quantity";

export interface Check { name: string; ok: boolean; detail: string }
export type Units = "SI" | "US";
export type MixCode = "ACI318" | "BNBC2020";

// ---------------- unit constants ----------------
export const LB_KG = 0.45359237;
export const FT3_M3 = 0.028316846592;
export const YD3_M3 = 0.764554857984;
export const PSI_MPA = 0.006894757293;
/** 1 kg/m³ = 1.6856 lb/yd³. */
export const KG_M3_TO_LB_YD3 = YD3_M3 / LB_KG;
/** 1 lb/ft³ = 16.018 kg/m³. */
export const LB_FT3_TO_KG_M3 = LB_KG / FT3_M3;
export const CEMENT_SACK_LB = 94;

const fx = (x: number, d = 0) => x.toFixed(d);
/** Trim trailing zeros: 0.620 → "0.62". */
const tz = (x: number, d = 3) => String(Number(x.toFixed(d)));
/** Round a ratio down to 0.01 (conservative), tolerant of floating-point noise. */
export const floor2 = (x: number) => Math.floor(x * 100 + 1e-6) / 100;
const ceilTol = (x: number) => Math.ceil(x - 1e-6);
const pct = (x: number) => `${tz(x, 2)}%`;
/** w/c with 2 decimals, or 3 when it has a third one (e.g. a given 0.365). */
const fwc = (x: number) => (Math.abs(x * 100 - Math.round(x * 100)) < 1e-6 ? x.toFixed(2) : x.toFixed(3));

// ---------------- ACI 211.1 tables ----------------

export type AciConstruction = "footings_walls" | "plain_footings_caissons" | "beams_walls" | "columns" | "pavements_slabs" | "mass";
const CONSTRUCTION_LABEL: Record<AciConstruction, string> = {
  footings_walls: "reinforced foundation walls and footings", plain_footings_caissons: "plain footings, caissons and substructure walls",
  beams_walls: "beams and reinforced walls", columns: "building columns", pavements_slabs: "pavements and slabs", mass: "mass concrete",
};

interface AciTables {
  label: { slump: string; water: string; wc: string; wcSevere: string; ca: string; mass: string };
  sizeUnit: string; slumpUnit: string; strengthUnit: string; massUnit: string;
  /** mass unit → kg/m³ */
  toKgM3: number;
  sizes: readonly number[];
  slumpRows: readonly (readonly [number, number])[];
  /** [min, max] slump by type of construction; max may be increased by `notVibratedExtra` without vibration */
  slumpByConstruction: Record<AciConstruction, readonly [number, number]>;
  notVibratedExtra: number;
  water: { nonAE: readonly (readonly number[])[]; AE: readonly (readonly number[])[] };
  wc: { strengths: readonly number[]; nonAE: readonly number[]; AE: readonly number[] };
  pcaWc: { strengths: readonly number[]; nonAE: readonly number[]; AE: readonly number[] };
  massEstimate: { nonAE: readonly number[]; AE: readonly number[] };
  roundedReduction: { nonAE: number; AE: number };
}

const ENTRAPPED_AIR = [3, 2.5, 2, 1.5, 1, 0.5, 0.3, 0.2] as const;
const AE_AIR = {
  mild: [4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0],
  moderate: [6.0, 5.5, 5.0, 4.5, 4.5, 4.0, 3.5, 3.0],
  severe: [7.5, 7.0, 6.0, 6.0, 5.5, 5.0, 4.5, 4.0], // "extreme exposure" in the SI table, "severe exposure" in the inch-pound one
} as const;
/** Table A1.5.3.6 / 6.3.6: dry-rodded coarse aggregate volume per unit volume of concrete (rows by size, columns by sand FM). */
const CA_FM = [2.4, 2.6, 2.8, 3.0] as const;
const CA_VOLUME = [
  [0.50, 0.48, 0.46, 0.44], [0.59, 0.57, 0.55, 0.53], [0.66, 0.64, 0.62, 0.60], [0.71, 0.69, 0.67, 0.65],
  [0.75, 0.73, 0.71, 0.69], [0.78, 0.76, 0.74, 0.72], [0.82, 0.80, 0.78, 0.76], [0.87, 0.85, 0.83, 0.81],
] as const;

export const ACI_SI: AciTables = {
  label: { slump: "ACI 211.1 Table A1.5.3.1", water: "ACI 211.1 Table A1.5.3.3", wc: "ACI 211.1 Table A1.5.3.4(a)", wcSevere: "ACI 211.1 Table A1.5.3.4(b)", ca: "ACI 211.1 Table A1.5.3.6", mass: "ACI 211.1 Table A1.5.3.7.1" },
  sizeUnit: "mm", slumpUnit: "mm", strengthUnit: "MPa", massUnit: "kg/m³", toKgM3: 1,
  sizes: [9.5, 12.5, 19, 25, 37.5, 50, 75, 150],
  slumpRows: [[25, 50], [75, 100], [150, 175]],
  slumpByConstruction: { footings_walls: [25, 75], plain_footings_caissons: [25, 75], beams_walls: [25, 100], columns: [25, 100], pavements_slabs: [25, 75], mass: [25, 75] },
  notVibratedExtra: 25,
  water: {
    nonAE: [[207, 199, 190, 179, 166, 154, 130, 113], [228, 216, 205, 193, 181, 169, 145, 124], [243, 228, 216, 202, 190, 178, 160, NaN]],
    AE: [[181, 175, 168, 160, 150, 142, 122, 107], [202, 193, 184, 175, 165, 157, 133, 119], [216, 205, 197, 184, 174, 166, 154, NaN]],
  },
  wc: { strengths: [15, 20, 25, 30, 35, 40], nonAE: [0.79, 0.69, 0.61, 0.54, 0.47, 0.42], AE: [0.70, 0.60, 0.52, 0.45, 0.39, NaN] },
  pcaWc: { strengths: [15, 20, 25, 30, 35, 40, 45], nonAE: [0.79, 0.69, 0.61, 0.54, 0.47, 0.42, 0.38], AE: [0.70, 0.60, 0.52, 0.45, 0.39, 0.34, 0.30] },
  massEstimate: { nonAE: [2280, 2310, 2345, 2380, 2410, 2445, 2490, 2530], AE: [2200, 2230, 2275, 2290, 2350, 2345, 2405, 2435] },
  roundedReduction: { nonAE: 18, AE: 15 },
};

export const ACI_US: AciTables = {
  label: { slump: "ACI 211.1 Table 6.3.1", water: "ACI 211.1 Table 6.3.3", wc: "ACI 211.1 Table 6.3.4(a)", wcSevere: "ACI 211.1 Table 6.3.4(b)", ca: "ACI 211.1 Table 6.3.6", mass: "ACI 211.1 Table 6.3.7.1" },
  sizeUnit: "in.", slumpUnit: "in.", strengthUnit: "psi", massUnit: "lb/yd³", toKgM3: 1 / KG_M3_TO_LB_YD3,
  sizes: [0.375, 0.5, 0.75, 1, 1.5, 2, 3, 6],
  slumpRows: [[1, 2], [3, 4], [6, 7]],
  slumpByConstruction: { footings_walls: [1, 3], plain_footings_caissons: [1, 3], beams_walls: [1, 4], columns: [1, 4], pavements_slabs: [1, 3], mass: [1, 2] },
  notVibratedExtra: 1,
  water: {
    nonAE: [[350, 335, 315, 300, 275, 260, 220, 190], [385, 365, 340, 325, 300, 285, 245, 210], [410, 385, 360, 340, 315, 300, 270, NaN]],
    AE: [[305, 295, 280, 270, 250, 240, 205, 180], [340, 325, 305, 295, 275, 265, 225, 200], [365, 345, 325, 310, 290, 280, 260, NaN]],
  },
  wc: { strengths: [2000, 3000, 4000, 5000, 6000], nonAE: [0.82, 0.68, 0.57, 0.48, 0.41], AE: [0.74, 0.59, 0.48, 0.40, NaN] },
  pcaWc: { strengths: [2000, 3000, 4000, 5000, 6000, 7000], nonAE: [0.82, 0.68, 0.57, 0.48, 0.41, 0.33], AE: [0.74, 0.59, 0.48, 0.40, 0.32, NaN] },
  massEstimate: { nonAE: [3840, 3890, 3960, 4010, 4070, 4120, 4200, 4260], AE: [3710, 3760, 3840, 3850, 3910, 3950, 4040, 4110] },
  roundedReduction: { nonAE: 30, AE: 25 },
};

// ---------------- table lookup helpers ----------------

/** Position in a table axis: value = row[i0] + t·(row[i1] − row[i0]). */
interface Pos { i0: number; i1: number; t: number; text: string }
const at = (row: readonly number[], p: Pos) => (p.t === 0 ? row[p.i0] : row[p.i0] + p.t * (row[p.i1] - row[p.i0]));
/** "a + t·(b − a) = v" or "a" */
const atText = (row: readonly number[], p: Pos, d = 1) => (p.t === 0 ? tz(row[p.i0], 3) : `${tz(row[p.i0], 3)} + ${fx(p.t, 3)} × (${tz(row[p.i1], 3)} − ${tz(row[p.i0], 3)}) = ${fx(at(row, p), d)}`);

/**
 * Column of an aggregate-size axis. Sizes within 7% of a column are read as that column (20 mm → 19 mm, 40 mm → 37.5 mm);
 * other sizes inside the table are interpolated linearly with a warning; sizes outside throw (no extrapolation).
 */
function sizePos(sizes: readonly number[], nms: number, unit: string, table: string, notes: string[], warnings: string[]): Pos {
  if (!(nms > 0)) throw new Error("Nominal maximum aggregate size must be positive");
  let best = 0;
  sizes.forEach((s, i) => { if (Math.abs(nms - s) / s < Math.abs(nms - sizes[best]) / sizes[best]) best = i; });
  const rel = Math.abs(nms - sizes[best]) / sizes[best];
  if (rel <= 0.07) {
    if (rel > 1e-9) notes.push(`Aggregate size ${tz(nms)} ${unit} is read as the ${tz(sizes[best])} ${unit} column of ${table}.`);
    return { i0: best, i1: best, t: 0, text: `${tz(sizes[best])} ${unit}` };
  }
  const n = sizes.length;
  if (nms < sizes[0] || nms > sizes[n - 1]) throw new Error(`Nominal maximum aggregate size ${tz(nms)} ${unit} is outside ${table} (${tz(sizes[0])} to ${tz(sizes[n - 1])} ${unit}); the table is not extrapolated.`);
  let i = 0;
  while (sizes[i + 1] < nms) i++;
  warnings.push(`Aggregate size ${tz(nms)} ${unit} is not a column of ${table}: values interpolated linearly between ${tz(sizes[i])} and ${tz(sizes[i + 1])} ${unit}. Confirm by trial.`);
  return { i0: i, i1: i + 1, t: (nms - sizes[i]) / (sizes[i + 1] - sizes[i]), text: `${tz(nms)} ${unit} (between ${tz(sizes[i])} and ${tz(sizes[i + 1])} ${unit})` };
}

/** Row of the slump axis: inside a row's range → that row; between rows → linear; outside → clamped with a warning. */
function slumpPos(rows: readonly (readonly [number, number])[], s: number, unit: string, table: string, warnings: string[]): Pos {
  const name = (r: readonly [number, number]) => `${r[0]}–${r[1]} ${unit}`;
  if (s < rows[0][0]) {
    warnings.push(`Slump ${tz(s)} ${unit} is below ${table} (lowest row ${name(rows[0])}): the ${name(rows[0])} row is used (more water than needed; reduce it after the trial batch).`);
    return { i0: 0, i1: 0, t: 0, text: `${name(rows[0])} row (clamped)` };
  }
  for (let i = 0; i < rows.length; i++) {
    if (s <= rows[i][1]) {
      if (s >= rows[i][0]) return { i0: i, i1: i, t: 0, text: `${name(rows[i])} row` };
      const t = (s - rows[i - 1][1]) / (rows[i][0] - rows[i - 1][1]);
      return { i0: i - 1, i1: i, t, text: `${tz(s)} ${unit}, between the ${name(rows[i - 1])} and ${name(rows[i])} rows` };
    }
  }
  const last = rows.length - 1;
  warnings.push(`Slump ${tz(s)} ${unit} is above ${table} (highest row ${name(rows[last])}): that row is used. Higher slumps need a water-reducing admixture (superplasticiser), not more water.`);
  return { i0: last, i1: last, t: 0, text: `${name(rows[last])} row (clamped)` };
}

/**
 * Linear interpolation on an ascending axis; x must be inside. Returns the segment [i, i + 1] and t ∈ [0, 1];
 * `exact` when x is a tabulated value (then v is that table value).
 */
function interp(xs: readonly number[], ys: readonly number[], x: number): { v: number; i: number; t: number; exact: boolean } {
  const n = xs.length;
  for (let j = 0; j < n; j++) if (Math.abs(x - xs[j]) <= 1e-9 * Math.max(1, Math.abs(xs[j]))) return { v: ys[j], i: Math.min(j, n - 2), t: j === n - 1 ? 1 : 0, exact: true };
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return { v: ys[i] + t * (ys[i + 1] - ys[i]), i, t, exact: false };
}
const lerp = (ys: readonly number[], r: { i: number; t: number }) => (r.t === 0 ? ys[r.i] : ys[r.i] + r.t * (ys[r.i + 1] - ys[r.i]));

// ---------------- required average strength ----------------

/** ACI 318M-08 Table 5.3.1.2 / BNBC Table 6.5.4: standard-deviation multiplier for 15–29 tests (interpolated). */
export function stdDevFactor(numTests: number): number {
  if (numTests < 15) throw new Error("At least 15 consecutive tests are needed to use a standard deviation");
  if (numTests >= 30) return 1;
  return interp([15, 20, 25, 30], [1.16, 1.08, 1.03, 1.0], numTests).v;
}

export interface FcrInput { code: MixCode; units?: Units; fc: number; stdDev?: number; numTests?: number }
export interface FcrResult { fcr: number; fcrMPa: number; unit: string; hasData: boolean; rule: string; steps: string[]; notes: string[] }

/**
 * Required average compressive strength f'cr, returned in the input units (psi for US with ACI318) and in MPa.
 *  ACI318: ACI 318M-08 Sec. 5.3.2 (psi constants for US units). BNBC2020: BNBC 2020 Part 6 Sec. 5.6.2.2 (no 0.90f'c branch).
 */
export function requiredAverageStrength(inp: FcrInput): FcrResult {
  const us = inp.units === "US";
  const notes: string[] = [];
  const steps: string[] = [];
  if (!(inp.fc > 0)) throw new Error("f'c must be positive");
  // BNBC is an SI code: work in MPa and report psi as well.
  const psiRules = us && inp.code === "ACI318";
  const u = psiRules ? "psi" : "MPa";
  const fc = us && !psiRules ? inp.fc * PSI_MPA : inp.fc;
  const d = psiRules ? 0 : 1;
  const toMPa = (x: number) => (psiRules ? x * PSI_MPA : x);
  const out = (fcr: number, rule: string, hasData: boolean): FcrResult => {
    steps.push(`${rule}${us && !psiRules ? ` = ${fx(fcr / PSI_MPA)} psi` : ""}`);
    return { fcr: us && !psiRules ? fcr / PSI_MPA : fcr, fcrMPa: toMPa(fcr), unit: us ? "psi" : "MPa", hasData, rule, steps, notes };
  };
  const src = inp.code === "BNBC2020" ? "BNBC 2020 Part 6 Sec. 5.6.2.2" : psiRules ? "ACI 318 as tabulated in PCA EB001 Table 9-11 and Eq. 9-1 to 9-3" : "ACI 318M-08 Sec. 5.3.2 (= ACI 301 for ACI 318-14/19)";
  let n = inp.numTests;
  if (inp.stdDev !== undefined && inp.stdDev > 0) {
    if (n === undefined) { n = 15; notes.push("Number of tests not given: 15 assumed (largest standard-deviation factor, 1.16)."); }
    if (n >= 15) {
      const k = stdDevFactor(n);
      const s = us && !psiRules ? inp.stdDev * PSI_MPA : inp.stdDev;
      const ks = k * s;
      const a = fc + 1.34 * ks;
      const lim = psiRules ? 5000 : 35;
      const c35 = psiRules ? 500 : 3.5;
      const tbl = inp.code === "BNBC2020" ? "Table 6.5.4" : "Table 5.3.1.2";
      steps.push(`Standard deviation s = ${fx(s, d + 1)} ${u} from ${n} tests: k = ${fx(k, 3)} (${tbl}), k·s = ${fx(ks, d + 2)} ${u}`);
      if (inp.code === "BNBC2020" || fc <= lim) {
        const b = fc + 2.33 * ks - c35;
        const fcr = Math.max(a, b);
        return out(fcr, `f'cr = max(f'c + 1.34ks, f'c + 2.33ks − ${c35}) = max(${fx(a, d + 1)}, ${fx(b, d + 1)}) = ${fx(fcr, d + 1)} ${u} (${src}, Eq. ${inp.code === "BNBC2020" ? "6.5.1/6.5.2" : "5-1/5-2"})`, true);
      }
      const b = 0.9 * fc + 2.33 * ks;
      const fcr = Math.max(a, b);
      return out(fcr, `f'c > ${lim} ${u}: f'cr = max(f'c + 1.34ks, 0.90f'c + 2.33ks) = max(${fx(a, d + 1)}, ${fx(b, d + 1)}) = ${fx(fcr, d + 1)} ${u} (${src}, Eq. 5-1/5-3)`, true);
    }
    notes.push(`Fewer than 15 tests (${n}): the standard deviation cannot be used; the no-data table applies.`);
  }
  if (inp.code === "BNBC2020") {
    const [add, band] = fc < 20 ? [7.0, "f'c < 20"] : fc <= 35 ? [8.5, "20 ≤ f'c ≤ 35"] : [10.0, "f'c > 35"];
    return out(fc + add, `No standard-deviation data, BNBC Table 6.5.5 (${band} MPa): f'cr = f'c + ${fx(add, 1)} = ${fx(fc, 1)} + ${fx(add, 1)} = ${fx(fc + add, 1)} MPa`, false);
  }
  if (psiRules) {
    if (fc < 3000) return out(fc + 1000, `No standard-deviation data, ACI 318-08 Table 5.3.2.2 (f'c < 3000 psi): f'cr = f'c + 1000 = ${fx(fc + 1000)} psi`, false);
    if (fc <= 5000) return out(fc + 1200, `No standard-deviation data, ACI 318-08 Table 5.3.2.2 (3000 ≤ f'c ≤ 5000 psi): f'cr = f'c + 1200 = ${fx(fc + 1200)} psi`, false);
    return out(1.1 * fc + 700, `No standard-deviation data, ACI 318-08 Table 5.3.2.2 (f'c > 5000 psi): f'cr = 1.10f'c + 700 = ${fx(1.1 * fc + 700)} psi`, false);
  }
  if (fc < 21) return out(fc + 7, `No standard-deviation data, ACI 318M-08 Table 5.3.2.2 (f'c < 21 MPa): f'cr = f'c + 7.0 = ${fx(fc + 7, 1)} MPa`, false);
  if (fc <= 35) return out(fc + 8.3, `No standard-deviation data, ACI 318M-08 Table 5.3.2.2 (21 ≤ f'c ≤ 35 MPa): f'cr = f'c + 8.3 = ${fx(fc + 8.3, 1)} MPa`, false);
  return out(1.1 * fc + 5, `No standard-deviation data, ACI 318M-08 Table 5.3.2.2 (f'c > 35 MPa): f'cr = 1.10f'c + 5.0 = ${fx(1.1 * fc + 5, 1)} MPa`, false);
}

// ---------------- batches ----------------

export interface Batch { water: number; cement: number; coarse: number; fine: number; admixture: number; total: number }
const mkBatch = (water: number, cement: number, coarse: number, fine: number, admixture = 0): Batch => ({ water, cement, coarse, fine, admixture, total: water + cement + coarse + fine + admixture });
const scaleBatch = (b: Batch, f: number): Batch => mkBatch(b.water * f, b.cement * f, b.coarse * f, b.fine * f, b.admixture * f);

/** Aggregate: oven-dry mass per m³, absorption and total moisture as fractions of the oven-dry mass. */
interface Agg { dry: number; abs: number; mc: number }

/**
 * Oven-dry, SSD and field (moist) batches for the same concrete. Water in each is the water to add at the mixer:
 * oven-dry = W + absorbed water; SSD = W; field = W − Σ dry·(moisture − absorption) (ACI 211.1 Sec. 6.3.8, IS 10262 A-11).
 */
function stateBatches(W: number, C: number, ca: Agg, fa: Agg, adm: number) {
  const surface = ca.dry * (ca.mc - ca.abs) + fa.dry * (fa.mc - fa.abs);
  return {
    dry: mkBatch(W + ca.dry * ca.abs + fa.dry * fa.abs, C, ca.dry, fa.dry, adm),
    ssd: mkBatch(W, C, ca.dry * (1 + ca.abs), fa.dry * (1 + fa.abs), adm),
    field: mkBatch(W - surface, C, ca.dry * (1 + ca.mc), fa.dry * (1 + fa.mc), adm),
    surfaceWater: surface,
  };
}

export interface SiteOptions {
  volume?: number;
  volumeUnit?: "m3" | "cft" | "yd3";
  wastagePercent?: number;
  /** loose bulk density of the sand as delivered, kg/m³ (for cft) */
  sandLooseDensity?: number;
  /** loose bulk density of the stone chips as delivered, kg/m³ (for cft) */
  stoneLooseDensity?: number;
}

/** Site quantities: cement bags per m³, field batch per 50 kg bag, for a given volume, and cft of aggregate when loose densities are known. */
function siteQuantities(field: Batch, opts: SiteOptions, steps: string[], notes: string[]) {
  const bagsPerM3 = field.cement / CEMENT_BAG_KG;
  const perBag = scaleBatch(field, CEMENT_BAG_KG / field.cement);
  const sacksPerYd3 = (field.cement * KG_M3_TO_LB_YD3) / CEMENT_SACK_LB;
  const cft = opts.sandLooseDensity || opts.stoneLooseDensity ? {
    sandPerM3: opts.sandLooseDensity ? (field.fine / opts.sandLooseDensity) * CFT_PER_M3 : undefined,
    stonePerM3: opts.stoneLooseDensity ? (field.coarse / opts.stoneLooseDensity) * CFT_PER_M3 : undefined,
    sandPerBag: opts.sandLooseDensity ? (perBag.fine / opts.sandLooseDensity) * CFT_PER_M3 : undefined,
    stonePerBag: opts.stoneLooseDensity ? (perBag.coarse / opts.stoneLooseDensity) * CFT_PER_M3 : undefined,
  } : undefined;
  if (cft) notes.push("cft figures use the loose bulk densities given, for aggregate as delivered (moist sand bulks, so measure its density in the same state).");
  let forVolume: { volume: number; unit: string; volumeM3: number; wastagePercent: number; batch: Batch; cementBags: number; cementSacks: number; sandCft?: number; stoneCft?: number } | undefined;
  if (opts.volume !== undefined) {
    if (!(opts.volume > 0)) throw new Error("volume must be positive");
    const unit = opts.volumeUnit ?? "m3";
    const m3 = unit === "cft" ? opts.volume / CFT_PER_M3 : unit === "yd3" ? opts.volume * YD3_M3 : opts.volume;
    const w = opts.wastagePercent ?? 0;
    if (w < 0 || w > 50) throw new Error("wastagePercent must be between 0 and 50");
    const f = m3 * (1 + w / 100);
    const batch = scaleBatch(field, f);
    forVolume = { volume: opts.volume, unit, volumeM3: m3, wastagePercent: w, batch, cementBags: batch.cement / CEMENT_BAG_KG, cementSacks: (batch.cement / LB_KG) / CEMENT_SACK_LB, sandCft: cft?.sandPerM3 !== undefined ? cft.sandPerM3 * f : undefined, stoneCft: cft?.stonePerM3 !== undefined ? cft.stonePerM3 * f : undefined };
    steps.push(`For ${tz(opts.volume)} ${unit === "m3" ? "m³" : unit === "yd3" ? "yd³" : "cft"} = ${fx(m3, 3)} m³${w ? ` + ${w}% wastage = ${fx(f, 3)} m³` : ""}: field batch × ${fx(f, 3)} → cement ${fx(batch.cement)} kg (${fx(forVolume.cementBags, 1)} bags of 50 kg)`);
  }
  return { cementBagsPerM3: bagsPerM3, cementSacksPerYd3: sacksPerYd3, perBag, cft, forVolume };
}

/** lb/yd³ copy of a kg/m³ batch. */
const toUS = (b: Batch): Batch => scaleBatch(b, KG_M3_TO_LB_YD3);

// ---------------- ACI 211.1 absolute-volume / mass method ----------------

export type AirExposure = "mild" | "moderate" | "severe";
export type BnbcEnvironment = "mild" | "moderate" | "severe" | "very_severe" | "extreme";
export type SulfateExposure = "none" | "moderate" | "severe" | "very_severe";

export interface AciMixInput extends SiteOptions {
  units?: Units;
  /** f'cr rules and durability checks; default BNBC2020 for SI, ACI318 for US */
  code?: MixCode;
  /** specified strength f'c, MPa (psi if US) */
  fc: number;
  /** sample standard deviation, MPa (psi), from ≥ 15 consecutive tests */
  stdDev?: number;
  numTests?: number;
  /** required average strength given directly, MPa (psi) */
  fcrOverride?: number;
  /** target slump, mm (in.); or give construction */
  slump?: number;
  construction?: AciConstruction;
  vibrated?: boolean;
  /** nominal maximum aggregate size, mm (in.) */
  nms: number;
  /** fineness modulus of the sand */
  fm: number;
  /** oven-dry-rodded bulk density of the coarse aggregate, kg/m³ (lb/ft³ if US) */
  caDryRoddedDensity: number;
  caSG: number;
  faSG: number;
  /** basis of caSG/faSG: "dry" (bulk oven-dry, ACI 211.1 default) or "ssd" (converted: G_dry = G_ssd/(1 + absorption)) */
  sgBasis?: "dry" | "ssd";
  /** absorption, % of oven-dry mass */
  caAbsorption: number;
  faAbsorption: number;
  /** total moisture content, % of oven-dry mass (default = absorption, i.e. SSD) */
  caMoisture?: number;
  faMoisture?: number;
  cementSG?: number;
  airEntrained?: boolean;
  airExposure?: AirExposure;
  /** total air %, replaces the table value */
  airOverride?: number;
  roundedAggregate?: boolean;
  /** water reduction for rounded coarse aggregate, kg/m³ (lb/yd³); default ACI 18/15 kg (30/25 lb) */
  roundedAdjustment?: number;
  waterReducerPercent?: number;
  /** net mixing water, kg/m³ (lb/yd³): replaces the table and all adjustments */
  waterOverride?: number;
  /** w/c from trial data: replaces the strength table; durability limits still govern */
  wcOverride?: number;
  /** use PCA EB001 Table 9-3 rows above the ACI 211.1 w/c table (default true) */
  allowPcaExtension?: boolean;
  /** % change of the Table A1.5.3.6 coarse aggregate volume: +10 pavements, down to −10 for pumping */
  caVolumeAdjustPercent?: number;
  fineAggregateMethod?: "volume" | "mass";
  // durability
  freezeThaw?: boolean;
  seaWater?: boolean;
  sulfate?: SulfateExposure;
  thinSection?: boolean;
  sulfateResistingCement?: boolean;
  environment?: BnbcEnvironment;
  corrosive?: boolean;
  lowPermeability?: boolean;
  extraCover12mm?: boolean;
  upTo4Storeys?: boolean;
  element?: "general" | "pile" | "large_pile";
  brickAggregate?: boolean;
  /** project-specification limits */
  maxWc?: number;
  /** kg/m³ (lb/yd³ if US) */
  minCement?: number;
}

interface WcLimit { source: string; wc: number }
interface CementLimit { source: string; kg: number }

const BNBC_683 = { fc: [20, 25, 30, 35, 40, 45, 50], wc: [0.5, 0.5, 0.5, 0.45, 0.45, 0.4, 0.4], cement: [315, 325, 350, 375, 400, 410, 420] } as const;
const BNBC_ENV_MIN_FC: Record<BnbcEnvironment, number> = { mild: 20, moderate: 20, severe: 25, very_severe: 30, extreme: 35 };
const BNBC_656 = { fc: [17, 20, 25, 30], nonAE: [0.66, 0.6, 0.5, 0.4], AE: [0.54, 0.49, 0.39] } as const;

function checkFinite(name: string, x: number | undefined, lo: number, hi: number) {
  if (x === undefined) return;
  if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${name} = ${x} is outside the accepted range ${lo} to ${hi}`);
}

export function designAciMix(inp: AciMixInput) {
  const units: Units = inp.units ?? "SI";
  const us = units === "US";
  const code: MixCode = inp.code ?? (us ? "ACI318" : "BNBC2020");
  const T = us ? ACI_US : ACI_SI;
  const ae = inp.airEntrained ?? false;
  const K = T.toKgM3; // native mass unit → kg/m³
  const mu = T.massUnit;
  const nat = (kgm3: number) => kgm3 / K; // kg/m³ → native
  const show = (kgm3: number, d = 0) => `${fx(nat(kgm3), d)} ${mu}`;
  const rhoW = us ? 62.4 * LB_FT3_TO_KG_M3 : 1000; // kg/m³
  const steps: string[] = [];
  const checks: Check[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  // ---- validation ----
  checkFinite("fc", inp.fc, us ? 1000 : 7, us ? 15000 : 100);
  checkFinite("fm", inp.fm, 1.0, 4.0);
  checkFinite("caSG", inp.caSG, 1.5, 4.5);
  checkFinite("faSG", inp.faSG, 1.5, 4.5);
  checkFinite("cementSG", inp.cementSG, 2.5, 3.3);
  checkFinite("caAbsorption", inp.caAbsorption, 0, 25);
  checkFinite("faAbsorption", inp.faAbsorption, 0, 25);
  checkFinite("caMoisture", inp.caMoisture, 0, 30);
  checkFinite("faMoisture", inp.faMoisture, 0, 30);
  checkFinite("caDryRoddedDensity", inp.caDryRoddedDensity, us ? 50 : 800, us ? 150 : 2400);
  checkFinite("airOverride", inp.airOverride, 0, 12);
  checkFinite("waterReducerPercent", inp.waterReducerPercent, 0, 40);
  checkFinite("wcOverride", inp.wcOverride, 0.2, 1.0);
  checkFinite("maxWc", inp.maxWc, 0.2, 1.0);
  checkFinite("caVolumeAdjustPercent", inp.caVolumeAdjustPercent, -10, 10);
  checkFinite("stdDev", inp.stdDev, 0, us ? 2000 : 15);
  const Gc = inp.cementSG ?? 3.15;
  const ac = inp.caAbsorption / 100, af = inp.faAbsorption / 100;
  const mc = (inp.caMoisture ?? inp.caAbsorption) / 100, mf = (inp.faMoisture ?? inp.faAbsorption) / 100;
  const sgBasis = inp.sgBasis ?? "dry";
  const Gca = sgBasis === "ssd" ? inp.caSG / (1 + ac) : inp.caSG;
  const Gfa = sgBasis === "ssd" ? inp.faSG / (1 + af) : inp.faSG;
  const fcMPa = us ? inp.fc * PSI_MPA : inp.fc;

  const codeLabel = code === "BNBC2020" ? "BNBC 2020 (Part 6 Ch. 5, ACI-based)" : "ACI 318 (f'cr per ACI 318M-08 Sec. 5.3 / ACI 301)";
  steps.push(`Method: ACI 211.1-91 ${inp.fineAggregateMethod === "mass" ? "mass (estimated concrete weight)" : "absolute volume"} method; code ${codeLabel}; ${us ? "inch-pound tables (Chapter 6), inputs psi, in., lb/ft³" : "SI tables (Appendix 1)"}; ${ae ? "air-entrained" : "non-air-entrained"} concrete.`);
  if (sgBasis === "ssd") steps.push(`Specific gravities given on SSD basis → bulk oven-dry for the dry-mass method: CA ${tz(inp.caSG)}/${tz(1 + ac, 4)} = ${fx(Gca, 3)}, sand ${tz(inp.faSG)}/${tz(1 + af, 4)} = ${fx(Gfa, 3)}`);

  // ---- Step 0: f'cr ----
  let fcrNat: number, fcrMPa: number, hasData = false;
  if (inp.fcrOverride !== undefined) {
    checkFinite("fcrOverride", inp.fcrOverride, us ? 1000 : 7, us ? 15000 : 100);
    fcrNat = inp.fcrOverride; fcrMPa = us ? inp.fcrOverride * PSI_MPA : inp.fcrOverride;
    if (inp.fcrOverride < inp.fc) throw new Error("fcrOverride must not be less than f'c");
    steps.push(`Required average strength f'cr = ${tz(fcrNat, 1)} ${T.strengthUnit} (given)`);
  } else {
    const r = requiredAverageStrength({ code, units, fc: inp.fc, stdDev: inp.stdDev, numTests: inp.numTests });
    fcrNat = r.fcr; fcrMPa = r.fcrMPa; hasData = r.hasData;
    steps.push(...r.steps); notes.push(...r.notes);
  }

  // ---- Step 1: slump ----
  let slump = inp.slump;
  if (inp.construction) {
    const [lo, hi0] = T.slumpByConstruction[inp.construction];
    const vib = inp.vibrated ?? true;
    const hi = vib ? hi0 : hi0 + T.notVibratedExtra;
    if (slump === undefined) {
      slump = hi;
      steps.push(`Slump: ${T.label.slump}, ${CONSTRUCTION_LABEL[inp.construction]} → ${lo} to ${hi} ${T.slumpUnit}${vib ? "" : ` (maximum +${T.notVibratedExtra} ${T.slumpUnit}, not vibrated)`}; the maximum ${hi} ${T.slumpUnit} is used for the trial mix`);
    } else if (slump < lo || slump > hi) {
      warnings.push(`Slump ${tz(slump)} ${T.slumpUnit} is outside the ${lo}–${hi} ${T.slumpUnit} recommended for ${CONSTRUCTION_LABEL[inp.construction]} (${T.label.slump}).`);
    }
  }
  if (slump === undefined) throw new Error("Give the slump, or the type of construction to pick it from ACI 211.1 Table A1.5.3.1");
  checkFinite("slump", slump, 0, us ? 10 : 250);
  if (inp.slump !== undefined) steps.push(`Slump = ${tz(slump)} ${T.slumpUnit} (given)`);

  // ---- Step 2/3: water and air ----
  const zp = sizePos(T.sizes, inp.nms, T.sizeUnit, "the ACI 211.1 tables", notes, warnings);
  const sp = slumpPos(T.slumpRows, slump, T.slumpUnit, T.label.water, warnings);
  const rows = ae ? T.water.AE : T.water.nonAE;
  const rowVals = [sp.i0, sp.i1].map((ri) => at(rows[ri], zp));
  if (rowVals.some((v) => !Number.isFinite(v))) throw new Error(`${T.label.water} gives no water content for ${tz(inp.nms)} ${T.sizeUnit} aggregate at slumps above ${T.slumpRows[1][1]} ${T.slumpUnit}`);
  const wTable = sp.t === 0 ? rowVals[0] : rowVals[0] + sp.t * (rowVals[1] - rowVals[0]);
  const aeLabel = ae ? "air-entrained" : "non-air-entrained";
  steps.push(`Water: ${T.label.water}, ${aeLabel}, NMS ${zp.text}, slump ${sp.text}: ${sp.t === 0 ? atText(rows[sp.i0], zp) : `${fx(rowVals[0], 1)} + ${fx(sp.t, 3)} × (${fx(rowVals[1], 1)} − ${fx(rowVals[0], 1)}) = ${fx(wTable, 1)}`} ${mu}`);
  let Wn: number; // native units
  if (inp.waterOverride !== undefined) {
    checkFinite("waterOverride", inp.waterOverride * K, 80, 300);
    Wn = inp.waterOverride;
    steps.push(`Net mixing water = ${tz(Wn, 1)} ${mu} (given; replaces the table value and adjustments)`);
  } else {
    Wn = wTable;
    const rounded = inp.roundedAggregate || inp.roundedAdjustment !== undefined;
    if (rounded) {
      const red = inp.roundedAdjustment ?? (ae ? T.roundedReduction.AE : T.roundedReduction.nonAE);
      checkFinite("roundedAdjustment", red * K, 0, 40);
      const std = ae ? T.roundedReduction.AE : T.roundedReduction.nonAE;
      steps.push(`Rounded coarse aggregate: − ${tz(red)} ${mu}${inp.roundedAdjustment !== undefined && red !== std ? ` (given; ${T.label.water} note says about ${std})` : ` (${T.label.water} note)`} → ${fx(Wn - red, 1)} ${mu}`);
      Wn -= red;
    }
    if (inp.waterReducerPercent) {
      steps.push(`Water-reducing admixture −${tz(inp.waterReducerPercent)}%: ${fx(Wn, 1)} × ${tz(1 - inp.waterReducerPercent / 100, 4)} = ${fx(Wn * (1 - inp.waterReducerPercent / 100), 1)} ${mu}`);
      Wn *= 1 - inp.waterReducerPercent / 100;
    }
  }
  const WnR = Math.round(Wn);
  if (Math.abs(WnR - Wn) > 1e-6) steps.push(`Net mixing water rounded to W = ${WnR} ${mu}`);
  const W = WnR * K; // kg/m³

  let air: number;
  if (inp.airOverride !== undefined) {
    air = inp.airOverride;
    steps.push(`Air content = ${pct(air)} (given)`);
  } else if (ae) {
    const ex = inp.airExposure ?? "moderate";
    air = at(AE_AIR[ex], zp);
    steps.push(`Recommended total air, ${ex === "severe" ? (us ? "severe" : "extreme (severe)") : ex} exposure, ${zp.text}: ${atText(AE_AIR[ex], zp, 2)}% (${T.label.water})`);
  } else {
    air = at(ENTRAPPED_AIR, zp);
    steps.push(`Entrapped air (non-air-entrained), ${zp.text}: ${atText(ENTRAPPED_AIR, zp, 2)}% (${T.label.water})`);
  }

  // ---- Step 4: w/c ----
  const wcLimits: WcLimit[] = [];
  const cementLimits: CementLimit[] = [];
  let wcStrength: number;
  if (inp.wcOverride !== undefined) {
    wcStrength = inp.wcOverride;
    steps.push(`w/c for strength = ${fwc(wcStrength)} (given, e.g. from trial mixes; replaces ${T.label.wc})`);
  } else {
    const aciXs = T.wc.strengths.filter((_, i) => Number.isFinite((ae ? T.wc.AE : T.wc.nonAE)[i]));
    const aciYs = (ae ? T.wc.AE : T.wc.nonAE).filter((v) => Number.isFinite(v));
    const pcaXs = T.pcaWc.strengths.filter((_, i) => Number.isFinite((ae ? T.pcaWc.AE : T.pcaWc.nonAE)[i]));
    const pcaYs = (ae ? T.pcaWc.AE : T.pcaWc.nonAE).filter((v) => Number.isFinite(v));
    const su = T.strengthUnit;
    const d = us ? 0 : 1;
    let xs = aciXs, ys = aciYs, tbl = T.label.wc;
    if (fcrNat < xs[0]) {
      warnings.push(`f'cr ${fx(fcrNat, d)} ${su} is below ${tbl} (lowest ${xs[0]} ${su}): the ${xs[0]} ${su} value is used (conservative).`);
      wcStrength = ys[0];
      steps.push(`w/c for strength: ${tbl}, ${aeLabel}, f'cr below the table → ${fx(ys[0], 2)} (clamped at ${xs[0]} ${su})`);
    } else {
      if (fcrNat > xs[xs.length - 1] + 1e-9) {
        const allow = inp.allowPcaExtension ?? true;
        if (!allow || fcrNat > pcaXs[pcaXs.length - 1] + 1e-9)
          throw new Error(`f'cr = ${fx(fcrNat, d)} ${su} is above ${tbl} (${aeLabel}, max ${xs[xs.length - 1]} ${su})${allow ? ` and the PCA EB001 Table 9-3 extension (max ${pcaXs[pcaXs.length - 1]} ${su})` : ""}. The table is not extrapolated: give wcOverride from trial-mix or field data${allow ? "" : ", or allow the PCA extension"} (see ACI 211.4R for high-strength concrete).`);
        xs = pcaXs; ys = pcaYs; tbl = "PCA EB001 Table 9-3 (ACI 211.1 values plus PCA rows)";
        warnings.push(`f'cr ${fx(fcrNat, d)} ${su} is above ${T.label.wc} (${aeLabel}, max ${aciXs[aciXs.length - 1]} ${su}): w/c interpolated with the PCA EB001 Table 9-3 rows (${pcaXs.filter((x) => !aciXs.includes(x)).map((x) => `${x} ${su}`).join(", ")}), which are PCA values, not ACI 211.1. Confirm by trial mixes.`);
      }
      const r = interp(xs, ys, fcrNat);
      const raw = r.v;
      wcStrength = floor2(raw);
      steps.push(`w/c for strength: ${tbl}, ${aeLabel}: f'cr ${fx(fcrNat, d)} ${su}${r.exact ? ` → ${fx(raw, 2)}` : ` between ${xs[r.i]} ${su} (${fx(ys[r.i], 2)}) and ${xs[r.i + 1]} ${su} (${fx(ys[r.i + 1], 2)}): ${fx(ys[r.i], 2)} + (${fx(fcrNat, d)} − ${xs[r.i]})/(${xs[r.i + 1]} − ${xs[r.i]}) × (${fx(ys[r.i + 1], 2)} − ${fx(ys[r.i], 2)}) = ${fx(raw, 3)}`}${Math.abs(raw - wcStrength) > 1e-9 ? ` → ${fx(wcStrength, 2)} (rounded down to 0.01, as in the ACI 211.1 examples)` : ""}`);
    }
    notes.push(`${T.label.wc} assumes Type I cement and NMS about 19–25 mm (3/4–1 in.); strength at a given w/c rises as the aggregate size decreases.`);
  }

  // ACI 211.1 Table A1.5.3.4(b): severe exposures (both codes)
  const sulfate = inp.sulfate ?? "none";
  const thin = inp.thinSection ?? false;
  if (inp.freezeThaw) {
    wcLimits.push({ source: `${T.label.wcSevere}, wet and freeze-thaw, ${thin ? "thin section" : "other structures"}`, wc: thin ? 0.45 : 0.5 });
    if (!ae) warnings.push(`${T.label.wcSevere}: concrete frequently wet and exposed to freezing and thawing should also be air-entrained.`);
  }
  if (inp.seaWater || sulfate !== "none") {
    const base = thin ? 0.4 : 0.45;
    const srl = inp.sulfateResistingCement ? 0.05 : 0;
    wcLimits.push({ source: `${T.label.wcSevere}, sea water or sulfates, ${thin ? "thin section" : "other structures"}${srl ? " (+0.05, Type II/V cement)" : ""}`, wc: base + srl });
  }

  // ---- code-specific durability ----
  const minFc = code === "BNBC2020" ? (inp.upTo4Storeys ? 17 : 20) : 17;
  checks.push({ name: code === "BNBC2020" ? "Minimum strength (BNBC Part 6 Sec. 5.5.4)" : "Minimum strength (ACI 318-19 Table 19.2.1.1)", ok: fcMPa >= minFc - 1e-9, detail: `f'c ${fx(fcMPa, 1)} MPa ${fcMPa >= minFc - 1e-9 ? "≥" : "<"} ${minFc} MPa${code === "BNBC2020" && inp.upTo4Storeys ? " (buildings up to 4 storeys)" : code === "ACI318" ? " (2500 psi)" : ""}` });
  if (code === "BNBC2020") {
    if (inp.fcrOverride !== undefined) notes.push("f'cr given directly: the BNBC Table 6.5.6 w/c limits (for mixes without field or trial data) are not applied.");
    else if (!hasData && fcMPa < 17 - 1e-9) notes.push("f'c below 17 MPa: BNBC Table 6.5.6 does not cover it (and it is below the structural minimum).");
    else if (!hasData) {
      const aeT = ae ? BNBC_656.AE : BNBC_656.nonAE;
      const xs = BNBC_656.fc.slice(0, aeT.length);
      if (fcMPa > xs[xs.length - 1] + 1e-9) warnings.push(`BNBC Table 6.5.6 stops at ${xs[xs.length - 1]} MPa${ae ? " for air-entrained concrete" : ""}: above that, BNBC Sec. 5.6.3 requires proportions from field records or trial mixtures (Sec. 5.6.2). These proportions are only the starting point for those trials.`);
      else if (fcMPa >= xs[0] - 1e-9) {
        const r = interp(xs, aeT, fcMPa);
        const lim = floor2(r.v);
        wcLimits.push({ source: `BNBC Table 6.5.6 (no field or trial data), f'c ${fx(fcMPa, 1)} MPa`, wc: lim });
        if (inp.waterReducerPercent) notes.push("BNBC Sec. 5.6.3.2: Table 6.5.6 is not meant for concrete with admixtures other than air-entraining; its limit is still applied here as a conservative bound.");
      }
    }
    const env = inp.environment ?? "mild";
    if (!inp.environment) notes.push("BNBC exposure environment not given: 'mild' assumed (Table 6.8.3). Set environment for exterior, wet, coastal or aggressive exposure.");
    let col = 0;
    BNBC_683.fc.forEach((f, i) => { if (fcMPa >= f - 1e-9) col = i; });
    wcLimits.push({ source: `BNBC Table 6.8.3 (${BNBC_683.fc[col]} MPa column, 20 mm aggregate)`, wc: BNBC_683.wc[col] });
    cementLimits.push({ source: `BNBC Table 6.8.3 (${BNBC_683.fc[col]} MPa column)`, kg: BNBC_683.cement[col] });
    if (zp.t !== 0 || T.sizes[zp.i0] !== (us ? 0.75 : 19)) notes.push("BNBC Table 6.8.3 is written for 20 mm aggregate; BNBC gives no adjustment for other sizes.");
    const envMin = BNBC_ENV_MIN_FC[env];
    if (envMin > 20) checks.push({ name: `BNBC Table 6.8.3 minimum strength (${env.replace("_", " ")} environment)`, ok: fcMPa >= envMin - 1e-9, detail: `f'c ${fx(fcMPa, 1)} MPa ${fcMPa >= envMin - 1e-9 ? "≥" : "<"} ${envMin} MPa` });
    if (inp.lowPermeability) wcLimits.push({ source: "BNBC Sec. 5.5.1.1 (low permeability)", wc: 0.5 });
    if (inp.seaWater) wcLimits.push({ source: `BNBC Sec. 5.5.1.2 (brackish/sea water${inp.extraCover12mm ? ", cover +12 mm" : ""})`, wc: inp.extraCover12mm ? 0.45 : 0.4 });
    if (sulfate !== "none") wcLimits.push({ source: `BNBC Table 6.5.2 (${sulfate.replace("_", " ")} sulphate; cement other than CEM I)`, wc: sulfate === "moderate" ? 0.5 : 0.45 });
    if (inp.element === "pile" || inp.element === "large_pile") {
      cementLimits.push({ source: `BNBC Part 6 Ch. 3, tremie-concreted ${inp.element === "pile" ? "pile (smaller diameter, length ≤ 10 m)" : "larger/deeper pile"}`, kg: inp.element === "pile" ? 350 : 400 });
      notes.push("BNBC Ch. 3: tremie concrete for piles needs a slump of about 125–200 mm.");
    }
    if (inp.corrosive) {
      wcLimits.push({ source: "BNBC Sec. 8.1.7.8 (corrosive/severe environment, w/c 0.40–0.45)", wc: 0.45 });
      cementLimits.push({ source: "BNBC Sec. 8.1.7.8 (corrosive/severe environment)", kg: 400 });
      checks.push({ name: "BNBC 8.1.7.8 minimum strength (corrosive)", ok: fcMPa >= 25 - 1e-9, detail: `f'c ${fx(fcMPa, 1)} MPa vs 25 MPa` });
      const nmsMm = us ? inp.nms * 25.4 : inp.nms;
      checks.push({ name: "BNBC 8.1.7.8 coarse aggregate 20 mm down stone chips", ok: nmsMm <= 20 * 1.07 && !inp.brickAggregate, detail: `${inp.brickAggregate ? "brick chips (khoa) are prohibited; " : ""}NMS ${tz(inp.nms)} ${T.sizeUnit}${nmsMm > 20 * 1.07 ? " > 20 mm" : ""}` });
      checks.push({ name: "BNBC 8.1.7.8 sand FM ≥ 2.20", ok: inp.fm >= 2.2 - 1e-9, detail: `FM ${tz(inp.fm, 2)}` });
    } else if (inp.brickAggregate) {
      notes.push("Brick chips (khoa): ACI 211.1 tables are for stone/gravel. Khoa absorbs much more water (often 10–20%): pre-wet it to SSD and rely on trial mixes. BNBC Sec. 8.1.7.8 prohibits khoa in corrosive/severe environments.");
    }
    if (env !== "mild" && env !== "moderate" && inp.brickAggregate && !inp.corrosive) warnings.push(`Brick chips in a ${env.replace("_", " ")} environment: BNBC Sec. 8.1.7.8 prohibits khoa for corrosive or other severe exposure.`);
  } else {
    notes.push("ACI 318-19 Chapter 19 exposure classes (F, S, W, C: Table 19.3.2.1) set further w/cm, f'c and air limits that are not built in here: pass maxWc/minCement from the project specification.");
  }
  if (inp.maxWc !== undefined) wcLimits.push({ source: "project specification", wc: inp.maxWc });
  if (inp.minCement !== undefined) cementLimits.push({ source: "project specification", kg: inp.minCement * K });

  let wc = wcStrength, governs = inp.wcOverride !== undefined ? "given w/c" : "strength";
  for (const l of wcLimits) if (l.wc < wc - 1e-9) { wc = l.wc; governs = l.source; }
  if (wcLimits.length) steps.push(`Durability limits on w/c: ${wcLimits.map((l) => `${l.source} ≤ ${fwc(l.wc)}`).join("; ")} → design w/c = ${fwc(wc)} (${governs} governs)`);
  else steps.push(`Design w/c = ${fwc(wc)}`);
  if (wcLimits.length) {
    const minL = Math.min(...wcLimits.map((l) => l.wc));
    checks.push({ name: "Maximum w/c (durability)", ok: wc <= minL + 1e-9, detail: `${fwc(wc)} ≤ ${fwc(minL)} (${wcLimits.find((l) => l.wc === minL)!.source})` });
  }
  if (inp.corrosive && code === "BNBC2020" && wc < 0.4 - 1e-9) notes.push(`BNBC Sec. 8.1.7.8 specifies w/c between 0.40 and 0.45; the strength requirement gives ${fwc(wc)}, which is lower (denser, more durable). Agree this with the engineer.`);

  // ---- Step 5: cement ----
  let Cn = ceilTol(WnR / wc);
  const cStep = `Cement = W / (w/c) = ${WnR} / ${fwc(wc)} = ${fx(WnR / wc, 1)} → ${Cn} ${mu} (rounded up)`;
  let minC: CementLimit | undefined;
  for (const l of cementLimits) if (!minC || l.kg > minC.kg) minC = l;
  if (minC && Cn * K < minC.kg - 1e-6) {
    const req = ceilTol(minC.kg / K);
    steps.push(`${cStep} < minimum ${req} ${mu} (${minC.source}) → cement = ${req} ${mu}; effective w/c = ${WnR}/${req} = ${fx(WnR / req, 3)} (ACI 211.1 Sec. 6.3.5: the larger cement governs)`);
    Cn = req;
  } else steps.push(`${cStep}${minC ? ` ≥ minimum ${fx(nat(minC.kg))} ${mu} (${minC.source})` : ""}`);
  const C = Cn * K;
  if (minC) checks.push({ name: "Minimum cement content", ok: C >= minC.kg - 1e-6, detail: `${show(C)} ≥ ${show(minC.kg)} (${minC.source})` });

  // ---- Step 6: coarse aggregate ----
  let fm = inp.fm;
  if (fm < CA_FM[0] || fm > CA_FM[CA_FM.length - 1]) {
    const cl = Math.min(Math.max(fm, CA_FM[0]), CA_FM[CA_FM.length - 1]);
    warnings.push(`Sand FM ${tz(inp.fm, 2)} is outside ${T.label.ca} (2.40–3.00): the FM ${fx(cl, 2)} column is used, not extrapolated. ${inp.fm < 2.4 ? "Fine sand needs more water and less sand; consider blending with coarse sand (e.g. Sylhet sand) and confirm by trial." : ""}`.trim());
    fm = cl;
  }
  const fmI = interp(CA_FM, CA_FM, fm);
  const byFm = CA_VOLUME.map((row) => lerp(row, fmI));
  const b0 = at(byFm, zp);
  const adj = inp.caVolumeAdjustPercent ?? 0;
  const bFrac = b0 * (1 + adj / 100);
  const druw = us ? inp.caDryRoddedDensity * LB_FT3_TO_KG_M3 : inp.caDryRoddedDensity;
  const caDry = bFrac * druw;
  const fmTxt = fmI.exact ? `FM ${fx(fm, 2)}` : `FM ${fx(fm, 2)} (between ${fx(CA_FM[fmI.i], 2)} and ${fx(CA_FM[fmI.i + 1], 2)})`;
  steps.push(`Coarse aggregate: ${T.label.ca}, NMS ${zp.text}, ${fmTxt} → ${fx(b0, 3)} (dry-rodded volume per unit volume of concrete)${adj ? ` × (1 ${adj > 0 ? "+" : "−"} ${Math.abs(adj)}%) = ${fx(bFrac, 3)}${adj > 0 ? " (less workable, e.g. pavement)" : " (more workable, e.g. pumping)"}` : ""}; × dry-rodded density ${tz(inp.caDryRoddedDensity, 1)} ${us ? "lb/ft³ × 27" : "kg/m³"} = ${show(caDry)} (oven-dry)`);

  // ---- Step 7: fine aggregate ----
  const vW = W / rhoW, vC = C / (Gc * rhoW), vCA = caDry / (Gca * rhoW), vAir = air / 100;
  const vKnown = vW + vC + vCA + vAir;
  if (vKnown >= 0.95) throw new Error(`Water, cement, coarse aggregate and air already fill ${fx(vKnown, 3)} m³ of each m³: no room for sand. Check the inputs.`);
  const faVol = (1 - vKnown) * Gfa * rhoW;
  const Unat = at(ae ? T.massEstimate.AE : T.massEstimate.nonAE, zp);
  const U = Unat * K;
  const faMass = U - (W + C + caDry);
  const volTxt = us
    ? `absolute volumes per yd³ (27 ft³, water 62.4 lb/ft³): water ${fx(nat(W))}/62.4 = ${fx(27 * vW, 2)}, cement ${fx(nat(C))}/(${tz(Gc)} × 62.4) = ${fx(27 * vC, 2)}, coarse ${fx(nat(caDry))}/(${fx(Gca, 3)} × 62.4) = ${fx(27 * vCA, 2)}, air ${tz(air, 2)}% × 27 = ${fx(27 * vAir, 2)}; total ${fx(27 * vKnown, 2)} ft³ → sand (27 − ${fx(27 * vKnown, 2)}) × ${fx(Gfa, 3)} × 62.4 = ${show(faVol)} (oven-dry)`
    : `absolute volumes per m³: water ${fx(W, 1)}/1000 = ${fx(vW, 3)}, cement ${fx(C, 1)}/(${tz(Gc)} × 1000) = ${fx(vC, 3)}, coarse ${fx(caDry, 1)}/(${fx(Gca, 3)} × 1000) = ${fx(vCA, 3)}, air ${fx(vAir, 3)}; total ${fx(vKnown, 3)} → sand ${fx(1 - vKnown, 3)} × ${fx(Gfa, 3)} × 1000 = ${show(faVol, 1)} (oven-dry)`;
  const massTxt = `${T.label.mass}, ${aeLabel}, ${zp.text}: ${atText(ae ? T.massEstimate.AE : T.massEstimate.nonAE, zp)} ${mu} → sand = ${fx(Unat)} − (${fx(nat(W))} + ${fx(nat(C))} + ${fx(nat(caDry))}) = ${show(faMass)}`;
  const method = inp.fineAggregateMethod ?? "volume";
  if (faMass <= 0) throw new Error("Mass method gives no sand: check the inputs");
  let faDry: number;
  if (method === "mass") {
    faDry = faMass;
    steps.push(`Sand by mass (estimated concrete weight): ${massTxt}`);
    steps.push(`Cross-check by absolute volume: ${volTxt}`);
    const yieldV = vW + vC + vCA + faDry / (Gfa * rhoW) + vAir;
    checks.push({ name: "Yield of the mass-method batch", ok: Math.abs(yieldV - 1) <= 0.02, detail: `absolute volume ${fx(yieldV, 3)} m³ per m³ (${T.label.mass} is a first estimate for SG 2.7; the absolute volume method is exact)` });
  } else {
    faDry = faVol;
    steps.push(`Sand by absolute volume: ${volTxt}`);
    steps.push(`Cross-check by mass: ${massTxt}`);
  }

  // ---- Step 8: moisture ----
  const ca: Agg = { dry: caDry, abs: ac, mc }, fa: Agg = { dry: faDry, abs: af, mc: mf };
  const b = stateBatches(W, C, ca, fa, 0);
  steps.push(`SSD masses: coarse ${fx(nat(caDry))} × ${tz(1 + ac, 4)} = ${fx(nat(b.ssd.coarse))}, sand ${fx(nat(faDry))} × ${tz(1 + af, 4)} = ${fx(nat(b.ssd.fine))} ${mu}; with oven-dry aggregates add the absorbed water: ${fx(nat(W))} + ${fx(nat(caDry * ac), 1)} + ${fx(nat(faDry * af), 1)} = ${fx(nat(b.dry.water))} ${mu}`);
  if (inp.caMoisture !== undefined || inp.faMoisture !== undefined) {
    steps.push(`Field (moisture CA ${pct(mc * 100)}, sand ${pct(mf * 100)}): coarse ${fx(nat(caDry))} × ${tz(1 + mc, 4)} = ${fx(nat(b.field.coarse))}, sand ${fx(nat(faDry))} × ${tz(1 + mf, 4)} = ${fx(nat(b.field.fine))}; water to add = ${fx(nat(W))} − ${fx(nat(caDry))} × (${pct(mc * 100)} − ${pct(ac * 100)}) − ${fx(nat(faDry))} × (${pct(mf * 100)} − ${pct(af * 100)}) = ${fx(nat(b.field.water))} ${mu} (ACI 211.1 Sec. 6.3.8)`);
    if (inp.caMoisture === undefined || inp.faMoisture === undefined) notes.push(`Moisture not given for the ${inp.caMoisture === undefined ? "coarse aggregate" : "sand"}: taken as SSD (moisture = absorption).`);
  } else notes.push("Aggregate moisture not given: the field batch assumes SSD aggregates. Give caMoisture/faMoisture (total moisture, % of oven-dry mass) for the moisture correction.");
  checks.push({ name: "Water to add at the mixer", ok: b.field.water > 0, detail: `${show(b.field.water)}${b.field.water > 0 ? "" : ": the aggregates carry more free water than the mix needs; dry them or reduce their moisture"}` });

  const site = siteQuantities(b.field, {
    volume: inp.volume, volumeUnit: inp.volumeUnit ?? (us ? "yd3" : "m3"), wastagePercent: inp.wastagePercent,
    sandLooseDensity: inp.sandLooseDensity !== undefined ? (us ? inp.sandLooseDensity * LB_FT3_TO_KG_M3 : inp.sandLooseDensity) : undefined,
    stoneLooseDensity: inp.stoneLooseDensity !== undefined ? (us ? inp.stoneLooseDensity * LB_FT3_TO_KG_M3 : inp.stoneLooseDensity) : undefined,
  }, steps, notes);
  const ratio = `1 : ${fx(b.ssd.fine / C, 2)} : ${fx(b.ssd.coarse / C, 2)}`;
  steps.push(`Mix by mass (SSD) cement : sand : coarse = ${ratio}, w/c ${fwc(wc)}; cement ${us ? `${fx(site.cementSacksPerYd3, 2)} sacks of 94 lb per yd³` : `${fx(site.cementBagsPerM3, 2)} bags of 50 kg per m³`}`);

  notes.push(
    "Starting proportions for trial batches: adjust water, cement and aggregate from the trial batch (ACI 211.1 Sec. 6.3.9). BNBC 5.6.2.3(b) wants at least three w/c ratios bracketing f'cr, each tested with three cylinders.",
    "Basis (ACI 211.1): coarse aggregate from the oven-dry-rodded volume, masses on oven-dry basis with bulk oven-dry specific gravities; the SSD and field columns carry the same concrete.",
    code === "BNBC2020"
      ? "Sources: ACI 211.1-91 (R2009) Appendix 1 Tables A1.5.3.1–A1.5.3.7.1; BNBC 2020 Part 6 Ch. 5 Sec. 5.5, 5.6.2 (Tables 6.5.4–6.5.6), Ch. 8 Sec. 8.1.7 (Table 6.8.3, 8.1.7.8)."
      : `Sources: ACI 211.1-91 (R2009) ${us ? "Tables 6.3.1–6.3.7.1 (inch-pound)" : "Appendix 1 Tables A1.5.3.1–A1.5.3.7.1"}; ACI 318M-08 Sec. 5.3 (= ACI 301) for f'cr.`,
  );

  return {
    method: `ACI 211.1 ${method === "mass" ? "mass" : "absolute volume"} method`,
    code, units, airEntrained: ae,
    fc: inp.fc, fcr: fcrNat, fcrMPa, strengthUnit: T.strengthUnit,
    slump, nms: inp.nms,
    wcStrength, wc, wcGoverns: governs, wcLimits,
    water: W, cement: C, air,
    coarseVolumeFraction: bFrac,
    coarseDry: caDry, fineDry: faDry,
    fineByVolume: faVol, fineByMass: faMass,
    volumes: { water: vW, cement: vC, coarse: vCA, air: vAir, fine: method === "volume" ? 1 - vKnown : faDry / (Gfa * rhoW), known: vKnown },
    batches: { dry: b.dry, ssd: b.ssd, field: b.field },
    batchesUS: us ? { dry: toUS(b.dry), ssd: toUS(b.ssd), field: toUS(b.field) } : undefined,
    ratio,
    ...site,
    steps, checks, notes, warnings,
    ok: checks.every((c) => c.ok),
  };
}
export type AciMixResult = ReturnType<typeof designAciMix>;

// ---------------- IS 10262:2019 ----------------

const IS_SIZES = [10, 20, 40] as const;
const IS_WATER = [208, 186, 165] as const; // Table 4, angular, SSD, 50 mm slump
const IS_AIR = [1.5, 1.0, 0.8] as const; // Table 3
const IS_CA: Record<"I" | "II" | "III" | "IV", readonly number[]> = { IV: [0.54, 0.66, 0.73], III: [0.52, 0.64, 0.72], II: [0.50, 0.62, 0.71], I: [0.48, 0.60, 0.69] }; // Table 5, w/c 0.50
const IS_SHAPE_REDUCTION = { angular: 0, sub_angular: 10, gravel_crushed: 15, rounded: 20 } as const;
const IS_T6 = [40, 0, -30] as const; // IS 456 Table 6: cement adjustment for 10/20/40 mm
export type IsExposure = "mild" | "moderate" | "severe" | "very_severe" | "extreme";
/** IS 456:2000 Table 5 (20 mm aggregate): [min cement kg/m³, max free w/c, min grade (0 = none)] */
const IS456_T5: Record<IsExposure, { PCC: readonly [number, number, number]; RCC: readonly [number, number, number] }> = {
  mild: { PCC: [220, 0.6, 0], RCC: [300, 0.55, 20] },
  moderate: { PCC: [240, 0.6, 15], RCC: [300, 0.5, 25] },
  severe: { PCC: [250, 0.5, 20], RCC: [320, 0.45, 30] },
  very_severe: { PCC: [260, 0.45, 20], RCC: [340, 0.45, 35] },
  extreme: { PCC: [280, 0.4, 25], RCC: [360, 0.4, 40] },
};
/**
 * IS 10262:2019 Fig. 1, approximate digitisation (±1 MPa; NOT published values): 28-day strength (MPa) at each free w/c.
 * Curve 1: cement 33–43 MPa (OPC 33); curve 2: 43–53 MPa (OPC 43, or PPC/PSC when the strength is unknown); curve 3: ≥ 53 MPa (OPC 53).
 */
export const IS_FIG1 = {
  wc: [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
  curves: {
    1: [60, 50, 42.5, 36, 30, 25, 21, 17.5, 14.7],
    2: [65.5, 56, 48, 41.5, 35.5, 30, 25.7, 22, 18.9],
    3: [74, 64.5, 56, 48.7, 42.5, 37.4, 32.6, 28.3, 24.7],
  },
} as const;

/** IS 10262 Table 1 (X) and Table 2 (assumed S, good site control). */
export const isFactorX = (fck: number) => (fck <= 15 ? 5.0 : fck <= 25 ? 5.5 : fck <= 60 ? 6.5 : 8.0);
export const isAssumedS = (fck: number) => (fck <= 15 ? 3.5 : fck <= 25 ? 4.0 : fck <= 60 ? 5.0 : 6.0);

/** IS 10262 cl. 4.2: f'ck = max(fck + 1.65S, fck + X). */
export function isTargetStrength(fck: number, stdDev?: number, siteControl: "good" | "fair" = "good") {
  if (!(fck > 0)) throw new Error("fck must be positive");
  const X = isFactorX(fck);
  const assumed = stdDev === undefined;
  const S = assumed ? isAssumedS(fck) + (siteControl === "fair" ? 1 : 0) : stdDev;
  const a = fck + 1.65 * S, b = fck + X;
  const target = Math.max(a, b);
  const step = `Target strength (IS 10262 cl. 4.2): S = ${tz(S, 2)} MPa ${assumed ? `(Table 2${siteControl === "fair" ? " + 1 for fair site control" : ", good site control"})` : "(from test records, ≥ 30 results per cl. 4.2.1.1)"}, X = ${X} (Table 1); f'ck = max(fck + 1.65S, fck + X) = max(${fx(a, 2)}, ${fx(b, 2)}) = ${fx(target, 2)} MPa`;
  return { target, S, X, step };
}

/** Free w/c for a target strength from the digitised IS 10262 Fig. 1 curve (approximate; confirm by trial mix). */
export function isWcFromFig1(target: number, curve: 1 | 2 | 3) {
  const s = IS_FIG1.curves[curve], w = IS_FIG1.wc;
  const n = w.length;
  if (target > s[0] + 1e-9) throw new Error(`Target strength ${fx(target, 2)} MPa is above IS 10262 Fig. 1 curve ${curve} (about ${s[0]} MPa at w/c 0.25): give wcOverride from trial mixes.`);
  if (target <= s[n - 1]) return { wc: w[n - 1], raw: w[n - 1], clamped: true, text: `Fig. 1 curve ${curve} (approximate reading): target ${fx(target, 2)} MPa is below ${s[n - 1]} MPa at w/c ${w[n - 1]}; w/c ${w[n - 1]} used (curve not extended)` };
  let i = 0;
  while (!(target <= s[i] && target >= s[i + 1])) i++;
  const t = (s[i] - target) / (s[i] - s[i + 1]);
  const raw = w[i] + t * (w[i + 1] - w[i]);
  return { wc: floor2(raw), raw, clamped: false, text: `Fig. 1 curve ${curve} (approximate reading of IS 10262 Fig. 1, ±1 MPa: confirm by trial mix): ${fx(target, 2)} MPa between w/c ${fx(w[i], 2)} (${s[i]} MPa) and ${fx(w[i + 1], 2)} (${s[i + 1]} MPa) → w/c = ${fx(w[i], 2)} + (${s[i]} − ${fx(target, 2)})/(${s[i]} − ${s[i + 1]}) × 0.05 = ${fx(raw, 3)} → ${fx(floor2(raw), 2)} (rounded down)` };
}

export interface IsMixInput extends SiteOptions {
  fck: number;
  stdDev?: number;
  siteControl?: "good" | "fair";
  nms: number;
  slump: number;
  aggregateShape?: keyof typeof IS_SHAPE_REDUCTION;
  zone: "I" | "II" | "III" | "IV";
  cementType?: "OPC33" | "OPC43" | "OPC53" | "PPC" | "PSC";
  /** actual 28-day cement strength, MPa (selects the Fig. 1 curve) */
  cementStrength?: number;
  cementSG?: number;
  caSG: number;
  faSG: number;
  /** basis of caSG/faSG: "ssd" (IS 10262 default) or "dry" (converted: G_ssd = G_dry·(1 + absorption)) */
  sgBasis?: "ssd" | "dry";
  caAbsorption: number;
  faAbsorption: number;
  caMoisture?: number;
  faMoisture?: number;
  admixtureDosagePercent?: number;
  admixtureSG?: number;
  waterReductionPercent?: number;
  wcOverride?: number;
  waterOverride?: number;
  exposure: IsExposure;
  concreteType?: "RCC" | "PCC";
  pumpReductionPercent?: number;
  minCement?: number;
  maxCement?: number;
  maxWc?: number;
}

export function designIsMix(inp: IsMixInput) {
  const steps: string[] = [];
  const checks: Check[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  if (inp.fck > 60) throw new Error("IS 10262 Section 2 covers grades up to M60; M65 and above follow Section 3 (high-strength concrete), which is not implemented.");
  checkFinite("fck", inp.fck, 10, 60);
  checkFinite("slump", inp.slump, 0, 250);
  checkFinite("caSG", inp.caSG, 1.5, 4.5);
  checkFinite("faSG", inp.faSG, 1.5, 4.5);
  checkFinite("cementSG", inp.cementSG, 2.5, 3.3);
  checkFinite("caAbsorption", inp.caAbsorption, 0, 25);
  checkFinite("faAbsorption", inp.faAbsorption, 0, 25);
  checkFinite("caMoisture", inp.caMoisture, 0, 30);
  checkFinite("faMoisture", inp.faMoisture, 0, 30);
  checkFinite("admixtureDosagePercent", inp.admixtureDosagePercent, 0, 5);
  checkFinite("admixtureSG", inp.admixtureSG, 0.9, 1.5);
  checkFinite("waterReductionPercent", inp.waterReductionPercent, 0, 40);
  checkFinite("wcOverride", inp.wcOverride, 0.2, 0.8);
  checkFinite("maxWc", inp.maxWc, 0.2, 0.8);
  checkFinite("pumpReductionPercent", inp.pumpReductionPercent, 0, 10);
  checkFinite("stdDev", inp.stdDev, 0.5, 15);
  checkFinite("cementStrength", inp.cementStrength, 20, 80);
  const Gc = inp.cementSG ?? 3.15;
  const ac = inp.caAbsorption / 100, af = inp.faAbsorption / 100;
  const mc = (inp.caMoisture ?? inp.caAbsorption) / 100, mf = (inp.faMoisture ?? inp.faAbsorption) / 100;
  const sgBasis = inp.sgBasis ?? "ssd";
  const Gca = sgBasis === "dry" ? inp.caSG * (1 + ac) : inp.caSG;
  const Gfa = sgBasis === "dry" ? inp.faSG * (1 + af) : inp.faSG;
  const type = inp.concreteType ?? "RCC";
  steps.push(`Method: IS 10262:2019 Section 2 (absolute volume, SSD aggregates) with IS 456:2000 durability (Table 5, ${inp.exposure.replace("_", " ")} exposure, ${type}).`);
  if (sgBasis === "dry") steps.push(`Specific gravities given on oven-dry basis → SSD: CA ${tz(inp.caSG)} × ${tz(1 + ac, 4)} = ${fx(Gca, 3)}, sand ${tz(inp.faSG)} × ${tz(1 + af, 4)} = ${fx(Gfa, 3)}`);

  // target strength
  const ts = isTargetStrength(inp.fck, inp.stdDev, inp.siteControl ?? "good");
  steps.push(ts.step);

  // air
  const zp = sizePos(IS_SIZES, inp.nms, "mm", "IS 10262 Tables 3–5", notes, warnings);
  const air = at(IS_AIR, zp);
  steps.push(`Entrapped air (Table 3), ${zp.text}: ${atText(IS_AIR, zp, 2)}%`);

  // w/c
  const [minCem20, maxWcT5, minGrade] = IS456_T5[inp.exposure][type];
  let wcStr: number;
  if (inp.wcOverride !== undefined) {
    wcStr = inp.wcOverride;
    steps.push(`Free w/c for strength = ${fwc(wcStr)} (given, e.g. read from IS 10262 Fig. 1 or from trial mixes)`);
  } else {
    let curve: 1 | 2 | 3;
    if (inp.cementStrength !== undefined) {
      if (inp.cementStrength < 33) { warnings.push(`Cement strength ${inp.cementStrength} MPa is below Fig. 1 curve 1 (33–43 MPa): curve 1 used.`); curve = 1; }
      else curve = inp.cementStrength < 43 ? 1 : inp.cementStrength < 53 ? 2 : 3;
    } else {
      const ct = inp.cementType ?? "OPC43";
      curve = ct === "OPC33" ? 1 : ct === "OPC53" ? 3 : 2;
      if (ct === "PPC" || ct === "PSC") notes.push("PPC/PSC without a measured 28-day cement strength: Fig. 1 curve 2 used (IS 10262 Fig. 1 Note 2).");
    }
    const r = isWcFromFig1(ts.target, curve);
    wcStr = r.wc;
    steps.push(`Free w/c for strength: ${r.text}`);
    warnings.push("The w/c is an approximate reading of IS 10262 Fig. 1 (curves only, no equation; digitised ±1 MPa): confirm by trial mix, or pass wcOverride.");
    if (r.clamped) warnings.push("Target strength is below the lowest point of the Fig. 1 curve: w/c 0.65 used (conservative).");
  }
  const wcLimits: WcLimit[] = [{ source: `IS 456 Table 5 (${inp.exposure.replace("_", " ")}, ${type})`, wc: maxWcT5 }];
  if (inp.maxWc !== undefined) wcLimits.push({ source: "project specification", wc: inp.maxWc });
  let wc = wcStr, governs = inp.wcOverride !== undefined ? "given w/c" : "strength (Fig. 1)";
  for (const l of wcLimits) if (l.wc < wc - 1e-9) { wc = l.wc; governs = l.source; }
  steps.push(`Durability (cl. 5.1.1): ${wcLimits.map((l) => `${l.source} ≤ ${fwc(l.wc)}`).join("; ")} → free w/c = ${fwc(wc)} (${governs} governs)`);
  checks.push({ name: "Maximum free w/c (IS 456 Table 5)", ok: wc <= maxWcT5 + 1e-9, detail: `${fwc(wc)} ≤ ${fwc(maxWcT5)}` });

  // water
  let W: number;
  if (inp.waterOverride !== undefined) {
    checkFinite("waterOverride", inp.waterOverride, 80, 300);
    W = inp.waterOverride;
    steps.push(`Water = ${tz(W, 1)} kg/m³ (given)`);
  } else {
    let w = at(IS_WATER, zp);
    steps.push(`Water (Table 4, angular, SSD, 50 mm slump), ${zp.text}: ${atText(IS_WATER, zp, 1)} kg/m³`);
    const shape = inp.aggregateShape ?? "angular";
    const red = IS_SHAPE_REDUCTION[shape];
    if (red) { steps.push(`${shape.replace("_", " ")} aggregate: − ${red} kg → ${fx(w - red, 1)} kg/m³ (cl. 5.3)`); w -= red; }
    if (Math.abs(inp.slump - 50) > 1e-9) {
      const f = 1 + (0.03 * (inp.slump - 50)) / 25;
      steps.push(`Slump ${tz(inp.slump)} mm: ${inp.slump > 50 ? "+" : "−"}3% per 25 mm (cl. 5.3): ${fx(w, 2)} × ${fx(f, 4)} = ${fx(w * f, 2)} kg/m³`);
      w *= f;
      if (inp.slump > 150 && !inp.waterReductionPercent) warnings.push("Slump above 150 mm without a water-reducing admixture: IS 10262 expects high slumps from admixtures; establish the water by trial.");
    }
    if (inp.slump < 25) warnings.push(`Slump ${inp.slump} mm is very low: the 3% per 25 mm rule is extrapolated below 50 mm; establish the water by trial.`);
    if (inp.waterReductionPercent) {
      steps.push(`Admixture water reduction ${tz(inp.waterReductionPercent)}% (cl. 5.3; plasticiser 5–10%, superplasticiser 20–30%): ${fx(w, 2)} × ${tz(1 - inp.waterReductionPercent / 100, 4)} = ${fx(w * (1 - inp.waterReductionPercent / 100), 2)} kg/m³`);
      w *= 1 - inp.waterReductionPercent / 100;
    }
    W = Math.round(w);
    steps.push(`Water W = ${W} kg/m³ (rounded to the nearest kg, as in IS 10262 Annex A)`);
  }

  // cement
  const t6 = at(IS_T6, zp);
  const minCem = minCem20 + t6;
  const cementLimits: CementLimit[] = [{ source: `IS 456 Table 5${t6 ? ` + Table 6 (${t6 > 0 ? "+" : ""}${fx(t6)} kg for ${zp.text})` : ""}`, kg: minCem }];
  if (inp.minCement !== undefined) cementLimits.push({ source: "project specification", kg: inp.minCement });
  let C = ceilTol(W / wc);
  const cStep = `Cement = ${fx(W)} / ${fwc(wc)} = ${fx(W / wc, 2)} → ${C} kg/m³ (rounded up, as in Annex A)`;
  let minC = cementLimits[0];
  for (const l of cementLimits) if (l.kg > minC.kg) minC = l;
  if (C < minC.kg - 1e-6) {
    const req = ceilTol(minC.kg);
    steps.push(`${cStep} < minimum ${fx(minC.kg)} kg/m³ (${minC.source}) → cement = ${req} kg/m³; effective w/c = ${fx(W / req, 3)} (cl. 5.4.1: the greater governs)`);
    C = req;
  } else steps.push(`${cStep} ≥ minimum ${fx(minC.kg)} kg/m³ (${minC.source})`);
  checks.push({ name: "Minimum cement (IS 456 Tables 5 and 6)", ok: C >= minC.kg - 1e-6, detail: `${C} ≥ ${fx(minC.kg)} kg/m³` });
  const maxCem = inp.maxCement ?? 450;
  checks.push({ name: "Maximum cement (IS 456 cl. 8.2.4.2)", ok: C <= maxCem + 1e-9, detail: `${C} ${C <= maxCem ? "≤" : ">"} ${maxCem} kg/m³ (OPC content, excluding fly ash and GGBS)${C > maxCem ? ": use a plasticiser or replace part of the cement with fly ash/GGBS" : ""}` });
  if (minGrade) checks.push({ name: `Minimum grade (IS 456 Table 5, ${inp.exposure.replace("_", " ")}, ${type})`, ok: inp.fck >= minGrade, detail: `M${tz(inp.fck)} ${inp.fck >= minGrade ? "≥" : "<"} M${minGrade}` });

  // coarse aggregate fraction
  const t5 = at(IS_CA[inp.zone], zp);
  const corr = ((0.5 - wc) / 0.05) * 0.01;
  let caFrac = t5 + corr;
  steps.push(`Coarse aggregate fraction of total aggregate (Table 5, Zone ${inp.zone}, ${zp.text}, w/c 0.50): ${atText(IS_CA[inp.zone], zp, 3)}; w/c ${fwc(wc)}: ${corr >= 0 ? "+" : "−"} ${fx(Math.abs(corr), 3)} (0.01 per 0.05 change, cl. 5.5.1) → ${fx(caFrac, 3)}`);
  if (inp.pumpReductionPercent) {
    steps.push(`Pumpable/congested: − ${tz(inp.pumpReductionPercent)}% (cl. 5.5.2): ${fx(caFrac, 3)} × ${tz(1 - inp.pumpReductionPercent / 100, 4)} = ${fx(caFrac * (1 - inp.pumpReductionPercent / 100), 3)}`);
    caFrac *= 1 - inp.pumpReductionPercent / 100;
  }
  const faFrac = 1 - caFrac;
  if (inp.zone === "IV" && type === "RCC") warnings.push("Zone IV sand in reinforced concrete: IS 10262 Table 5 Note 4 requires tests to prove the mix before use.");

  // volumes
  const dose = inp.admixtureDosagePercent ?? 0;
  const adm = (dose / 100) * C;
  const Gad = inp.admixtureSG ?? 1.145;
  if (dose && inp.admixtureSG === undefined) notes.push("Admixture specific gravity not given: 1.145 assumed (IS 10262 Annex A); use the manufacturer's value.");
  const vC = C / (Gc * 1000), vW = W / 1000, vAd = adm / (Gad * 1000), vAir = air / 100;
  const vAgg = 1 - vAir - (vC + vW + vAd);
  if (vAgg <= 0.4) throw new Error(`Only ${fx(vAgg, 3)} m³ of aggregate per m³: check the inputs.`);
  const caSSD = vAgg * caFrac * Gca * 1000;
  const faSSD = vAgg * faFrac * Gfa * 1000;
  steps.push(`Volumes per m³ (cl. 5.7): cement ${C}/(${tz(Gc)} × 1000) = ${fx(vC, 4)}, water ${fx(vW, 4)}${dose ? `, admixture ${tz(dose)}% × ${C} = ${fx(adm, 2)} kg → ${fx(adm, 2)}/(${tz(Gad)} × 1000) = ${fx(vAd, 4)}` : ""}; aggregate = (1 − ${fx(vAir, 3)}) − ${fx(vC + vW + vAd, 4)} = ${fx(vAgg, 4)} m³`);
  steps.push(`Coarse aggregate = ${fx(vAgg, 4)} × ${fx(caFrac, 3)} × ${fx(Gca, 3)} × 1000 = ${fx(caSSD, 1)} kg (SSD); sand = ${fx(vAgg, 4)} × ${fx(faFrac, 3)} × ${fx(Gfa, 3)} × 1000 = ${fx(faSSD, 1)} kg (SSD)`);

  // moisture
  const ca: Agg = { dry: caSSD / (1 + ac), abs: ac, mc }, fa: Agg = { dry: faSSD / (1 + af), abs: af, mc: mf };
  const b = stateBatches(W, C, ca, fa, adm);
  steps.push(`Oven-dry aggregates (A-11): coarse ${fx(caSSD, 1)}/${tz(1 + ac, 4)} = ${fx(ca.dry, 1)}, sand ${fx(faSSD, 1)}/${tz(1 + af, 4)} = ${fx(fa.dry, 1)} kg; water = ${W} + ${fx(caSSD - ca.dry, 2)} + ${fx(faSSD - fa.dry, 2)} = ${fx(b.dry.water, 1)} kg`);
  if (inp.caMoisture !== undefined || inp.faMoisture !== undefined) {
    steps.push(`Field (moisture CA ${pct(mc * 100)}, sand ${pct(mf * 100)} of dry mass): coarse ${fx(b.field.coarse, 1)}, sand ${fx(b.field.fine, 1)} kg; water to add = ${W} − ${fx(ca.dry, 1)} × (${pct(mc * 100)} − ${pct(ac * 100)}) − ${fx(fa.dry, 1)} × (${pct(mf * 100)} − ${pct(af * 100)}) = ${fx(b.field.water, 1)} kg`);
    if (inp.caMoisture === undefined || inp.faMoisture === undefined) notes.push(`Moisture not given for the ${inp.caMoisture === undefined ? "coarse aggregate" : "sand"}: taken as SSD.`);
  } else notes.push("Aggregate moisture not given: the field batch assumes SSD aggregates (IS 10262 A-10 note).");
  checks.push({ name: "Water to add at the mixer", ok: b.field.water > 0, detail: `${fx(b.field.water, 1)} kg/m³` });

  const site = siteQuantities(b.field, inp, steps, notes);
  const ratio = `1 : ${fx(b.ssd.fine / C, 2)} : ${fx(b.ssd.coarse / C, 2)}`;
  steps.push(`Mix by mass (SSD) cement : sand : coarse = ${ratio}, free w/c ${fwc(wc)}; cement ${fx(site.cementBagsPerM3, 2)} bags of 50 kg per m³`);
  notes.push(
    "Starting proportions: IS 10262 cl. 5.8 and A-15 require trial mix 1 and two more at w/c ±10%, then plotting strength against w/c.",
    "Sources: IS 10262:2019 Tables 1–5, cl. 4.2, 5.1–5.7, Annex A; IS 456:2000 Tables 5 and 6, cl. 8.2.4.2.",
  );
  if (dose) notes.push("IS 10262 cl. 5.1.1 note: near the durability w/c limit, count the water in the admixture too.");

  return {
    method: "IS 10262:2019", exposure: inp.exposure, concreteType: type,
    fck: inp.fck, targetStrength: ts.target, S: ts.S, X: ts.X,
    wcStrength: wcStr, wc, wcGoverns: governs,
    water: W, cement: C, admixture: adm, air,
    coarseFraction: caFrac, fineFraction: faFrac,
    volumes: { cement: vC, water: vW, admixture: vAd, air: vAir, aggregate: vAgg },
    coarseSSD: caSSD, fineSSD: faSSD,
    batches: { dry: b.dry, ssd: b.ssd, field: b.field },
    ratio,
    ...site,
    steps, checks, notes, warnings,
    ok: checks.every((c) => c.ok),
  };
}
export type IsMixResult = ReturnType<typeof designIsMix>;
