/**
 * Pavement design.
 *  - AASHTO Guide for Design of Pavement Structures (1993), flexible: structural number SN from the design equation
 *    (Part II Eq. 3.1.1; FHWA NHI-05-037 Eq. C.2; NCDOT Pavement Design Manual p.1), layered design (Part II Sec 3.1.5)
 *    and minimum thicknesses (Part II Sec 3.1.5), layer coefficient correlations (Part II Figs 2.6, 2.7 via the
 *    equations a2 = 0.249·log10(EBS) − 0.977, a3 = 0.227·log10(ESB) − 0.839), drainage coefficient m (Table 2.4).
 *    MR = 1500·CBR psi (Part I Eq. 1.5.1, fine-grained soil, soaked CBR ≤ 10). Optional IRC:37-2018 Eq. 6.1/6.2
 *    (MR = 10·CBR MPa for CBR ≤ 5, 17.6·CBR^0.64 MPa above).
 *  - AASHTO 1993 rigid: slab thickness D from the design equation (Part II Eq. 3.2.1; NCDOT p.2 — the FHWA web page
 *    misprints 1.624e7 as 1.64e7), load transfer J (FHWA NHI-05-037 Table C-4), drainage Cd (Table 2.5), k = MR/19.4
 *    for a slab directly on the roadbed (no subbase).
 *  - Reliability: ZR is the standard normal deviate (AASHTO Part I Table 4.1), computed with Acklam's inverse normal.
 *  - Traffic: cumulative ESAL N = 365·[(1+r)^n − 1]/r·A·D·L·F (IRC:37-2018 Eq. 4.2; AASHTO Part II Sec 2.1.2),
 *    lane distribution (IRC:37-2018 Sec 4.5 p.17; AASHTO Part II Table 2.2), equivalence factors (RHD Pavement Design
 *    Guide 2005 Table 3, LGED feeder-road design, IRC:37-2018 Table 4.2 indicative VDF), AASHTO flexible load
 *    equivalency (Part II Appendix D equation, as given by Huang, Pavement Analysis and Design, Eq. 6.4).
 *  - Bangladesh RHD Pavement Design Guide (April 2005) flexible catalogue: Table 1 (material CBR), Table 4 (cumulative
 *    growth factors), Table 5 (layer thicknesses), Table 6 and Appendix 1 (improved subgrade), Appendix 2 (worked
 *    example). https://rhd.gov.bd/Documents/RoadDesignAndSafety/PavemantDesignGuideforRHD/Index.pdf
 * Units: the AASHTO equations are US customary (psi, in, pci, 18-kip ESAL). SI inputs (MPa, mm, MPa/m) are converted
 * at the boundary and results are given in both. SN is always in inches (layer coefficients are per inch).
 * RHD / LGED / IRC methods are metric (mm, CBR %, msa = million standard axles of 80 kN / 8,160 kg).
 */

// ---------------- constants and formatting ----------------

export const MM_PER_IN = 25.4;
export const PSI_PER_MPA = 145.0377377;
/** 1 pci (lb/in³) = 0.271447 MPa/m. */
export const MPA_PER_M_PER_PCI = 0.2714471;

export type Units = "US" | "SI";
export interface Check { name: string; ok: boolean; detail: string }

const fx = (x: number, d = 3) => x.toFixed(d);
/** Integer with thousands separators (locale independent). */
export const fmtInt = (x: number) => Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const sgn = (x: number, d = 3) => (x < 0 ? `(${x.toFixed(d)})` : x.toFixed(d));
const ceilTo = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;

function need(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

// ---------------- reliability ----------------

/** AASHTO 1993 Part I Table 4.1: reliability R (%) → standard normal deviate ZR. */
export const ZR_TABLE: [number, number][] = [
  [50, 0], [60, -0.253], [70, -0.524], [75, -0.674], [80, -0.841], [85, -1.037], [90, -1.282], [91, -1.34], [92, -1.405],
  [93, -1.476], [94, -1.555], [95, -1.645], [96, -1.751], [97, -1.881], [98, -2.054], [99, -2.327], [99.9, -3.09], [99.99, -3.75],
];

/** Inverse standard normal CDF (Acklam's algorithm, relative error < 1.2e-9). */
export function normalInverse(p: number): number {
  need(p > 0 && p < 1, `normalInverse: p must be between 0 and 1 (got ${p})`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * ZR for reliability R % (50–99.99). Exact normal deviate: reproduces AASHTO Table 4.1 to ±0.001 except at 99.99 %,
 * where the table prints −3.750 but the exact deviate is −3.719.
 */
export function zrFromReliability(R: number): number {
  need(Number.isFinite(R) && R >= 50 && R <= 99.99, `Reliability must be between 50 and 99.99 % (got ${R}). AASHTO Table 2.2 suggests 85–99.9 for urban interstates, 50–80 for local roads.`);
  return R === 50 ? 0 : -normalInverse(R / 100);
}

// ---------------- subgrade and material correlations ----------------

export type MrCorrelation = "aashto" | "irc37";

/**
 * Subgrade resilient modulus from soaked CBR. aashto: MR = 1500·CBR psi (AASHTO Part I Eq. 1.5.1, fine-grained soil,
 * soaked CBR ≤ 10). irc37: IRC:37-2018 MR = 10·CBR MPa (CBR ≤ 5), 17.6·CBR^0.64 MPa (CBR > 5).
 */
export function mrFromCBR(cbr: number, method: MrCorrelation = "aashto") {
  need(Number.isFinite(cbr) && cbr > 0, `CBR must be greater than 0 % (got ${cbr})`);
  const notes: string[] = [];
  let psi: number, mpa: number, step: string;
  if (method === "irc37") {
    mpa = cbr <= 5 ? 10 * cbr : 17.6 * cbr ** 0.64;
    psi = mpa * PSI_PER_MPA;
    step = cbr <= 5 ? `MR = 10·CBR = 10 × ${cbr} = ${fx(mpa, 1)} MPa (${fx(psi, 0)} psi) (IRC:37-2018, CBR ≤ 5)` : `MR = 17.6·CBR^0.64 = 17.6 × ${cbr}^0.64 = ${fx(mpa, 1)} MPa (${fx(psi, 0)} psi) (IRC:37-2018, CBR > 5)`;
  } else {
    psi = 1500 * cbr;
    mpa = psi / PSI_PER_MPA;
    step = `MR = 1500·CBR = 1500 × ${cbr} = ${fx(psi, 0)} psi (${fx(mpa, 1)} MPa) (AASHTO 1993 Eq. 1.5.1)`;
    if (cbr > 10) notes.push(`CBR ${cbr} % > 10 %: MR = 1500·CBR is only valid for fine-grained soil with soaked CBR ≤ 10 and overestimates MR for granular soil. Measure MR (AASHTO T 307) or use another correlation.`);
  }
  return { MR_psi: psi, MR_MPa: mpa, step, notes };
}

/** AASHTO granular base layer coefficient from its modulus EBS (psi): a2 = 0.249·log10(EBS) − 0.977. */
export const baseCoefficient = (EBS_psi: number) => 0.249 * Math.log10(EBS_psi) - 0.977;
/** AASHTO granular subbase layer coefficient from its modulus ESB (psi): a3 = 0.227·log10(ESB) − 0.839. */
export const subbaseCoefficient = (ESB_psi: number) => 0.227 * Math.log10(ESB_psi) - 0.839;

/** Default layer coefficients: AASHTO typical and Bangladesh (JICA / RHD practice). */
export const LAYER_COEFFICIENTS = {
  aashto: { a1: 0.44, a2: 0.14, a3: 0.11, m: 1.0, label: "AASHTO typical: HMA 0.44, granular base 0.14, granular subbase 0.11" },
  bangladesh: { a1: 0.42, a2: 0.14, a3: 0.11, m: 1.0, label: "Bangladesh (JICA practice): bituminous 0.42, base 0.14, sub-base 0.11, m = 1.0" },
} as const;

// ---------------- drainage ----------------

export type DrainageQuality = "excellent" | "good" | "fair" | "poor" | "very_poor";
/** Percent of time the pavement structure is exposed to moisture levels approaching saturation. */
export type SaturationExposure = "under_1" | "1_to_5" | "5_to_25" | "over_25";
const EXPOSURE_LABEL: Record<SaturationExposure, string> = { under_1: "< 1 %", "1_to_5": "1–5 %", "5_to_25": "5–25 %", over_25: "> 25 %" };
const EXPOSURE_ORDER: SaturationExposure[] = ["under_1", "1_to_5", "5_to_25", "over_25"];

/** AASHTO 1993 Table 2.4: m for untreated base and subbase in flexible pavements, [max, min] per exposure column. */
export const M_TABLE: Record<DrainageQuality, [number, number][]> = {
  excellent: [[1.4, 1.35], [1.35, 1.3], [1.3, 1.2], [1.2, 1.2]],
  good: [[1.35, 1.25], [1.25, 1.15], [1.15, 1.0], [1.0, 1.0]],
  fair: [[1.25, 1.15], [1.15, 1.05], [1.0, 0.8], [0.8, 0.8]],
  poor: [[1.15, 1.05], [1.05, 0.8], [0.8, 0.6], [0.6, 0.6]],
  very_poor: [[1.05, 0.95], [0.95, 0.75], [0.75, 0.4], [0.4, 0.4]],
};
/** AASHTO 1993 Table 2.5: Cd for rigid pavements, [max, min] per exposure column. */
export const CD_TABLE: Record<DrainageQuality, [number, number][]> = {
  excellent: [[1.25, 1.2], [1.2, 1.15], [1.15, 1.1], [1.1, 1.1]],
  good: [[1.2, 1.15], [1.15, 1.1], [1.1, 1.0], [1.0, 1.0]],
  fair: [[1.15, 1.1], [1.1, 1.0], [1.0, 0.9], [0.9, 0.9]],
  poor: [[1.1, 1.0], [1.0, 0.9], [0.9, 0.8], [0.8, 0.8]],
  very_poor: [[1.0, 0.9], [0.9, 0.8], [0.8, 0.7], [0.7, 0.7]],
};

function drainageLookup(table: Record<DrainageQuality, [number, number][]>, name: string, src: string, q: DrainageQuality, e: SaturationExposure) {
  const row = table[q];
  need(!!row, `Unknown drainage quality "${q}". Use excellent, good, fair, poor or very_poor.`);
  const i = EXPOSURE_ORDER.indexOf(e);
  need(i >= 0, `Unknown saturation exposure "${e}". Use under_1, 1_to_5, 5_to_25 or over_25.`);
  const [max, min] = row[i];
  const value = (max + min) / 2;
  return { max, min, value, detail: `${name} (${src}): ${q.replace("_", " ")} drainage, ${EXPOSURE_LABEL[e]} of time near saturation → ${min === max ? fx(max, 2) : `${fx(max, 2)}–${fx(min, 2)}, midpoint ${fx(value, 3)}`}` };
}
/** Drainage coefficient m for granular layers (AASHTO Table 2.4): range and midpoint. */
export const drainageCoefficientM = (q: DrainageQuality, e: SaturationExposure) => drainageLookup(M_TABLE, "m", "AASHTO 1993 Table 2.4", q, e);
/** Drainage coefficient Cd for PCC slabs (AASHTO Table 2.5): range and midpoint. */
export const drainageCoefficientCd = (q: DrainageQuality, e: SaturationExposure) => drainageLookup(CD_TABLE, "Cd", "AASHTO 1993 Table 2.5", q, e);

/** AASHTO 1993 Part II Sec 3.1.5 minimum thicknesses (in) of asphalt concrete and aggregate base, by design ESAL. */
export function aashtoMinimumThickness(W18: number): { ac: number; base: number; band: string; surfaceTreatment: boolean } {
  if (W18 <= 50000) return { ac: 1.0, base: 4, band: "less than 50,000", surfaceTreatment: true };
  if (W18 <= 150000) return { ac: 2.0, base: 4, band: "50,001–150,000", surfaceTreatment: false };
  if (W18 <= 500000) return { ac: 2.5, base: 4, band: "150,001–500,000", surfaceTreatment: false };
  if (W18 <= 2e6) return { ac: 3.0, base: 6, band: "500,001–2,000,000", surfaceTreatment: false };
  if (W18 <= 7e6) return { ac: 3.5, base: 6, band: "2,000,001–7,000,000", surfaceTreatment: false };
  return { ac: 4.0, base: 6, band: "greater than 7,000,000", surfaceTreatment: false };
}

// ---------------- root finding ----------------

/**
 * Smallest x in [lo, hi] with g(x) ≥ target on the increasing branch of g: a coarse scan finds the bracket (after the
 * minimum of g, which skips a spurious singular branch), then bisection narrows it to `tol`. NaN counts as "below".
 */
function solveIncreasing(g: (x: number) => number, target: number, lo: number, hi: number, scan: number, tol = 1e-5): { x: number; belowRange: boolean } {
  let xMin = lo, gMin = Number.POSITIVE_INFINITY;
  for (let x = lo; x <= hi + 1e-12; x += scan) { const v = g(x); if (Number.isFinite(v) && v < gMin) { gMin = v; xMin = x; } }
  if (gMin >= target) return { x: xMin, belowRange: true };
  let a = xMin, b = Number.NaN;
  for (let x = xMin; x <= hi + 1e-12; x += scan) { const v = g(x); if (Number.isFinite(v) && v >= target) { b = x; break; } a = x; }
  need(Number.isFinite(b), "No solution in the valid range: the traffic is too high for this equation (check W18, units and moduli).");
  while (b - a > tol) { const m = (a + b) / 2; const v = g(m); if (Number.isFinite(v) && v >= target) b = m; else a = m; }
  return { x: b, belowRange: false };
}

// ---------------- AASHTO 1993 flexible ----------------

export interface FlexibleEqParams { ZR: number; S0: number; deltaPSI: number; MR: number /* psi */ }

/** AASHTO 1993 flexible design equation: log10(W18) for structural number SN (in) and MR (psi). */
export function flexibleLog10W18(SN: number, p: FlexibleEqParams): number {
  return p.ZR * p.S0 + 9.36 * Math.log10(SN + 1) - 0.2 + Math.log10(p.deltaPSI / (4.2 - 1.5)) / (0.4 + 1094 / (SN + 1) ** 5.19) + 2.32 * Math.log10(p.MR) - 8.07;
}

/** Required structural number SN (in) for W18 18-kip ESALs, by bisection (tolerance 0.00001). */
export function solveStructuralNumber(W18: number, p: FlexibleEqParams): number {
  need(W18 > 0 && Number.isFinite(W18), `W18 must be greater than 0 (got ${W18})`);
  need(p.MR > 0, `MR must be greater than 0 (got ${p.MR})`);
  return solveIncreasing((sn) => flexibleLog10W18(sn, p), Math.log10(W18), 0, 25, 0.05).x;
}

/** The flexible equation with numbers substituted at SN, as one step string. */
export function flexibleEquationStep(SN: number, p: FlexibleEqParams, label = "SN"): string {
  const t1 = p.ZR * p.S0, t2 = 9.36 * Math.log10(SN + 1), num = Math.log10(p.deltaPSI / 2.7), den = 0.4 + 1094 / (SN + 1) ** 5.19, t5 = 2.32 * Math.log10(p.MR);
  const tot = t1 + t2 - 0.2 + num / den + t5 - 8.07;
  return `log10(W18) = ZR·S0 + 9.36·log10(${label}+1) − 0.20 + log10[ΔPSI/(4.2−1.5)] / [0.40 + 1094/(${label}+1)^5.19] + 2.32·log10(MR) − 8.07 ` +
    `= ${sgn(p.ZR)}×${fx(p.S0, 2)} + 9.36·log10(${fx(SN + 1)}) − 0.20 + log10(${fx(p.deltaPSI, 2)}/2.7)/[0.40 + 1094/${fx(SN + 1)}^5.19] + 2.32·log10(${fx(p.MR, 0)}) − 8.07 ` +
    `= ${sgn(t1)} + ${fx(t2)} − 0.20 + ${sgn(num, 4)}/${fx(den, 4)} + ${fx(t5)} − 8.07 = ${fx(tot, 4)} → W18 = 10^${fx(tot, 4)} = ${fmtInt(10 ** tot)}`;
}

export interface FlexibleInput {
  units?: Units;
  W18: number; // design 18-kip (80 kN) ESAL in the design lane
  reliability: number; // %
  S0?: number; // overall standard deviation, default 0.45
  deltaPSI?: number; // default p0 − pt
  p0?: number; // initial serviceability, default 4.2
  pt?: number; // terminal serviceability, default 2.5
  MR?: number; // subgrade resilient modulus: psi (US) or MPa (SI)
  CBR?: number; // soaked subgrade CBR %, used when MR is not given
  mrCorrelation?: MrCorrelation;
  coefficients?: keyof typeof LAYER_COEFFICIENTS;
  a1?: number; a2?: number; a3?: number;
  m2?: number; m3?: number;
  drainageQuality?: DrainageQuality; saturationExposure?: SaturationExposure;
  baseModulus?: number; subbaseModulus?: number; // psi (US) or MPa (SI): enables the AASHTO layered design
  coefficientsFromModulus?: boolean; // a2, a3 from the AASHTO correlations with the base/subbase moduli
  subbase?: boolean; // default true (three layers); false = AC + base on subgrade
  D1?: number; D2?: number; D3?: number; // provided thicknesses, in (US) or mm (SI): check mode / solve the missing layer
  roundTo?: number; // rounding step for designed thicknesses: in (US, default 0.5) or mm (SI, default 10)
}

export interface FlexibleLayer { layer: string; a: number; m: number; D_in: number; D_mm: number; SN: number; minimum_in?: number }

export interface FlexibleResult {
  units: Units; W18: number; reliability: number; ZR: number; S0: number; deltaPSI: number; MR_psi: number; MR_MPa: number;
  SN: number; SN_mm: number; // required structural number, in (and × 25.4 mm)
  SN1?: number; SN2?: number; // layered design: SN required above the base and above the subbase
  layers?: FlexibleLayer[]; SNprovided?: number;
  ok: boolean; steps: string[]; checks: Check[]; notes: string[];
}

function serviceability(inp: { deltaPSI?: number; p0?: number; pt?: number }, p0Default: number, max: number, kind: string) {
  const p0 = inp.p0 ?? p0Default, pt = inp.pt ?? 2.5;
  const d = inp.deltaPSI ?? p0 - pt;
  if (inp.deltaPSI === undefined) {
    need(pt >= 1.5 && pt < p0, `Terminal serviceability pt must be between 1.5 and p0 (got pt = ${pt}, p0 = ${p0})`);
    need(p0 <= 5, `Initial serviceability p0 must be at most 5 (got ${p0})`);
  }
  need(Number.isFinite(d) && d > 0 && d <= max, `ΔPSI must be greater than 0 and at most ${max} for ${kind} pavements (got ${d}); ΔPSI = p0 − pt, typically ${kind === "flexible" ? "4.2 − 2.5 = 1.7" : "4.5 − 2.5 = 2.0"}.`);
  return { deltaPSI: d, p0, pt, step: inp.deltaPSI === undefined ? `ΔPSI = p0 − pt = ${p0} − ${pt} = ${fx(d, 2)}` : `ΔPSI = ${fx(d, 2)} (given)` };
}

function standardDeviation(S0: number | undefined, def: number, lo: number, hi: number, kind: string, notes: string[]) {
  const s = S0 ?? def;
  need(Number.isFinite(s) && s > 0 && s <= 1, `S0 must be between 0 and 1 (got ${s}); typical ${lo}–${hi} for ${kind} pavements.`);
  if (s < lo || s > hi) notes.push(`S0 = ${s} is outside the typical AASHTO range ${lo}–${hi} for ${kind} pavements.`);
  return s;
}

/**
 * AASHTO 1993 flexible pavement: required SN, and optionally (a) the AASHTO layered design when the base modulus is
 * given, or (b) a check of given thicknesses (solving the one missing layer if exactly one is left out).
 */
export function designFlexible(inp: FlexibleInput): FlexibleResult {
  const units = inp.units ?? "US";
  const si = units === "SI";
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  need(Number.isFinite(inp.W18) && inp.W18 > 0, `W18 (design ESAL) must be greater than 0 (got ${inp.W18})`);
  const ZR = zrFromReliability(inp.reliability);
  const S0 = standardDeviation(inp.S0, 0.45, 0.4, 0.5, "flexible", notes);
  const sv = serviceability(inp, 4.2, 2.7, "flexible");
  let MR_psi: number;
  if (inp.MR !== undefined) {
    need(inp.MR > 0, `MR must be greater than 0 (got ${inp.MR})`);
    MR_psi = si ? inp.MR * PSI_PER_MPA : inp.MR;
    steps.push(si ? `MR = ${inp.MR} MPa × 145.04 = ${fx(MR_psi, 0)} psi` : `MR = ${fx(MR_psi, 0)} psi (${fx(MR_psi / PSI_PER_MPA, 1)} MPa)`);
  } else {
    need(inp.CBR !== undefined, "Give the subgrade resilient modulus MR (psi, or MPa with units SI) or the soaked subgrade CBR (%).");
    const m = mrFromCBR(inp.CBR!, inp.mrCorrelation ?? "aashto");
    MR_psi = m.MR_psi; steps.push(m.step); notes.push(...m.notes);
  }
  steps.push(`ZR = ${fx(ZR, 3)} for R = ${inp.reliability} % (standard normal deviate, AASHTO Table 4.1); S0 = ${S0}; ${sv.step}`);
  const eq = { ZR, S0, deltaPSI: sv.deltaPSI, MR: MR_psi };
  const SN = solveStructuralNumber(inp.W18, eq);
  steps.push(`Solve for SN by bisection so that the equation gives W18 = ${fmtInt(inp.W18)} (log10 W18 = ${fx(Math.log10(inp.W18), 4)}):`);
  steps.push(flexibleEquationStep(SN, eq));
  steps.push(`Required SN = ${fx(SN, 2)} in (${fx(SN * MM_PER_IN, 0)} mm)`);

  const preset = LAYER_COEFFICIENTS[inp.coefficients ?? "aashto"];
  need(!!preset, `Unknown coefficient preset "${inp.coefficients}". Use aashto or bangladesh.`);
  const toPsi = (E: number) => (si ? E * PSI_PER_MPA : E);
  const EBS = inp.baseModulus !== undefined ? toPsi(inp.baseModulus) : undefined;
  const ESB = inp.subbaseModulus !== undefined ? toPsi(inp.subbaseModulus) : undefined;
  let a2 = inp.a2 ?? preset.a2, a3 = inp.a3 ?? preset.a3;
  const a1 = inp.a1 ?? preset.a1;
  if (inp.coefficientsFromModulus) {
    if (inp.a2 === undefined && EBS) { a2 = baseCoefficient(EBS); steps.push(`a2 = 0.249·log10(EBS) − 0.977 = 0.249·log10(${fx(EBS, 0)}) − 0.977 = ${fx(a2, 3)}`); }
    if (inp.a3 === undefined && ESB) { a3 = subbaseCoefficient(ESB); steps.push(`a3 = 0.227·log10(ESB) − 0.839 = 0.227·log10(${fx(ESB, 0)}) − 0.839 = ${fx(a3, 3)}`); }
  }
  let mDrain: number = preset.m;
  if (inp.drainageQuality && inp.saturationExposure) {
    const d = drainageCoefficientM(inp.drainageQuality, inp.saturationExposure);
    mDrain = d.value; steps.push(d.detail);
  }
  const m2 = inp.m2 ?? mDrain, m3 = inp.m3 ?? mDrain;
  for (const [k, v] of [["a1", a1], ["a2", a2], ["a3", a3], ["m2", m2], ["m3", m3]] as const) need(Number.isFinite(v) && v > 0 && v <= 1.5, `${k} must be greater than 0 and at most 1.5 (got ${v})`);

  const minT = aashtoMinimumThickness(inp.W18);
  const stepIn = si ? (inp.roundTo ?? 10) / MM_PER_IN : inp.roundTo ?? 0.5;
  need(stepIn > 0, "roundTo must be greater than 0");
  const len = (dIn: number) => (si ? `${fx(dIn * MM_PER_IN, 0)} mm` : `${fx(dIn, 1)} in`);
  const toIn = (d: number) => (si ? d / MM_PER_IN : d);
  const minAC = ceilTo(minT.ac, stepIn), minBase = ceilTo(minT.base, stepIn);
  const useSubbase = inp.subbase !== false;
  const base = { units, W18: inp.W18, reliability: inp.reliability, ZR, S0, deltaPSI: sv.deltaPSI, MR_psi, MR_MPa: MR_psi / PSI_PER_MPA, SN, SN_mm: SN * MM_PER_IN };
  const given = [inp.D1, inp.D2, useSubbase ? inp.D3 : 0];
  const anyGiven = inp.D1 !== undefined || inp.D2 !== undefined || inp.D3 !== undefined;
  const layer = (name: string, a: number, m: number, D: number, min?: number): FlexibleLayer => ({ layer: name, a, m, D_in: D, D_mm: D * MM_PER_IN, SN: a * m * D, minimum_in: min });
  const names = ["Asphalt concrete surface", "Granular base", "Granular subbase"];
  const minimumChecks = (D1: number, D2: number) => {
    checks.push({ name: "Minimum asphalt thickness (AASHTO 1993 Sec 3.1.5)", ok: D1 >= minT.ac - 1e-9, detail: `${len(D1)} vs ${fx(minT.ac, 1)} in (${fx(minT.ac * MM_PER_IN, 0)} mm) for W18 ${minT.band}${minT.surfaceTreatment ? " (or a surface treatment)" : ""}` });
    checks.push({ name: "Minimum aggregate base thickness (AASHTO 1993 Sec 3.1.5)", ok: D2 >= minT.base - 1e-9, detail: `${len(D2)} vs ${minT.base} in (${fx(minT.base * MM_PER_IN, 0)} mm)` });
  };
  const solveLayerSN = (E: number, label: string) => {
    const s = solveStructuralNumber(inp.W18, { ...eq, MR: E });
    steps.push(`${label} = SN required over a support of E = ${fx(E, 0)} psi: ${flexibleEquationStep(s, { ...eq, MR: E }, label)} → ${label} = ${fx(s, 2)}`);
    return s;
  };
  notes.push("AASHTO 1993 (FHWA NHI-05-037 Eq. C.2; NCDOT Pavement Design Manual). Many state DOTs now use AASHTOWare Pavement ME (MEPDG) for major highways; AASHTO 93 remains standard for local, county and parking-lot pavements.");
  notes.push("W18 is the design-lane 18-kip ESAL over the performance period (use the traffic_esal tool for directional and lane distribution).");

  if (!anyGiven && EBS === undefined) return { ...base, ok: true, steps, checks, notes };

  if (!anyGiven) {
    // AASHTO layered design (Part II Sec 3.1.5, Figure 3.2)
    need(EBS! > MR_psi, `Base modulus (${fx(EBS!, 0)} psi) must exceed the subgrade MR (${fx(MR_psi, 0)} psi)`);
    const three = useSubbase && ESB !== undefined;
    if (useSubbase && ESB === undefined) notes.push("No subbase modulus given: two-layer design (asphalt + base directly on the subgrade). Give subbaseModulus for a three-layer design.");
    if (three) need(ESB! > MR_psi && ESB! < EBS!, `Subbase modulus (${fx(ESB!, 0)} psi) must lie between the subgrade MR (${fx(MR_psi, 0)}) and the base modulus (${fx(EBS!, 0)})`);
    const SN1 = solveLayerSN(EBS!, "SN1");
    const D1r = SN1 / a1, D1 = Math.max(ceilTo(D1r, stepIn), minAC);
    steps.push(`D1* ≥ SN1/a1 = ${fx(SN1)}/${a1} = ${fx(D1r, 2)} in → D1 = ${len(D1)} (rounded up${D1 > ceilTo(D1r, stepIn) ? `, raised to the AASHTO minimum ${minT.ac} in` : ""}); SN1* = a1·D1 = ${a1} × ${fx(D1, 2)} = ${fx(a1 * D1)}`);
    const SN1s = a1 * D1;
    const SN2 = three ? solveLayerSN(ESB!, "SN2") : SN;
    const D2r = Math.max(0, (SN2 - SN1s) / (a2 * m2)), D2 = Math.max(ceilTo(D2r, stepIn), minBase);
    steps.push(`D2* ≥ (SN2 − SN1*)/(a2·m2) = (${fx(SN2)} − ${fx(SN1s)})/(${fx(a2, 3)} × ${fx(m2, 2)}) = ${fx(D2r, 2)} in → D2 = ${len(D2)}${D2 > ceilTo(D2r, stepIn) ? ` (AASHTO minimum base ${minT.base} in governs)` : ""}; SN2* = ${fx(a2 * m2 * D2)}`);
    const layers = [layer(names[0], a1, 1, D1, minT.ac), layer(names[1], a2, m2, D2, minT.base)];
    checks.push({ name: "Asphalt layer protects the base: a1·D1 ≥ SN1", ok: SN1s >= SN1 - 1e-9, detail: `${fx(SN1s)} ≥ ${fx(SN1)}` });
    if (three) {
      const D3r = Math.max(0, (SN - SN1s - a2 * m2 * D2) / (a3 * m3)), D3 = ceilTo(D3r, stepIn);
      steps.push(`D3* ≥ (SN3 − SN1* − SN2*)/(a3·m3) = (${fx(SN)} − ${fx(SN1s)} − ${fx(a2 * m2 * D2)})/(${fx(a3, 3)} × ${fx(m3, 2)}) = ${fx(D3r, 2)} in → D3 = ${len(D3)}`);
      layers.push(layer(names[2], a3, m3, D3));
      checks.push({ name: "Asphalt + base protect the subbase: SN1* + SN2* ≥ SN2", ok: SN1s + a2 * m2 * D2 >= SN2 - 1e-9, detail: `${fx(SN1s + a2 * m2 * D2)} ≥ ${fx(SN2)}` });
    }
    const SNp = layers.reduce((s, l) => s + l.SN, 0);
    steps.push(`SN provided = Σ ai·mi·Di = ${layers.map((l) => `${fx(l.a, 3)}×${fx(l.m, 2)}×${fx(l.D_in, 2)}`).join(" + ")} = ${fx(SNp)} ≥ SN required ${fx(SN)}`);
    checks.push({ name: "SN provided ≥ SN required", ok: SNp >= SN - 1e-9, detail: `${fx(SNp)} ≥ ${fx(SN)}` });
    minimumChecks(D1, D2);
    notes.push(`Thicknesses rounded up to ${si ? `${fx(stepIn * MM_PER_IN, 0)} mm` : `${stepIn} in`} (AASHTO rounds up to the nearest 1/2 in).`);
    return { ...base, SN1, SN2: three ? SN2 : undefined, layers, SNprovided: SNp, ok: checks.every((c) => c.ok), steps, checks, notes };
  }

  // check mode (or solve the one missing thickness)
  const missing = given.map((d, i) => (d === undefined ? i : -1)).filter((i) => i >= 0);
  need(missing.length <= 1, "Give all layer thicknesses to check them, or all but one to solve the missing one (set subbase: false for a two-layer pavement).");
  const coef = [[a1, 1], [a2, m2], [a3, m3]] as const;
  const D = given.map((d) => (d === undefined ? 0 : toIn(d)));
  D.forEach((d, i) => need(d >= 0, `D${i + 1} must not be negative`));
  if (missing.length === 1) {
    const i = missing[0];
    const others = D.reduce((s, d, j) => s + coef[j][0] * coef[j][1] * d, 0);
    const req = Math.max(0, (SN - others) / (coef[i][0] * coef[i][1]));
    const min = i === 0 ? minAC : i === 1 ? minBase : 0;
    D[i] = Math.max(ceilTo(req, stepIn), min);
    steps.push(`D${i + 1} = (SN − Σ other layers)/(a${i + 1}·m${i + 1}) = (${fx(SN)} − ${fx(others)})/(${fx(coef[i][0], 3)} × ${fx(coef[i][1], 2)}) = ${fx(req, 2)} in → ${len(D[i])}${D[i] > ceilTo(req, stepIn) ? " (AASHTO minimum governs)" : ""}`);
  }
  const layers = D.map((d, i) => layer(names[i], coef[i][0], coef[i][1], d)).filter((l, i) => i < 2 || useSubbase);
  const SNp = layers.reduce((s, l) => s + l.SN, 0);
  steps.push(`SN provided = a1·D1 + a2·m2·D2${useSubbase ? " + a3·m3·D3" : ""} = ${layers.map((l) => `${fx(l.a, 3)}×${fx(l.m, 2)}×${fx(l.D_in, 2)}`).join(" + ")} = ${fx(SNp)} in`);
  checks.push({ name: "SN provided ≥ SN required", ok: SNp >= SN - 1e-9, detail: `${fx(SNp)} vs ${fx(SN)} required (${SNp >= SN ? "OK" : `short by ${fx(SN - SNp)}`})` });
  if (EBS !== undefined) {
    const SN1 = solveLayerSN(EBS, "SN1");
    checks.push({ name: "Asphalt layer protects the base: a1·D1 ≥ SN1", ok: a1 * D[0] >= SN1 - 1e-9, detail: `${fx(a1 * D[0])} vs ${fx(SN1)}` });
    if (ESB !== undefined && useSubbase) {
      const SN2 = solveLayerSN(ESB, "SN2");
      checks.push({ name: "Asphalt + base protect the subbase: a1·D1 + a2·m2·D2 ≥ SN2", ok: a1 * D[0] + a2 * m2 * D[1] >= SN2 - 1e-9, detail: `${fx(a1 * D[0] + a2 * m2 * D[1])} vs ${fx(SN2)}` });
    }
  }
  minimumChecks(D[0], D[1]);
  return { ...base, layers, SNprovided: SNp, ok: checks.every((c) => c.ok), steps, checks, notes };
}

// ---------------- AASHTO 1993 rigid ----------------

export interface RigidEqParams { ZR: number; S0: number; deltaPSI: number; pt: number; Sc: number /* psi */; Cd: number; J: number; Ec: number /* psi */; k: number /* pci */ }

/** AASHTO 1993 rigid design equation: log10(W18) for slab thickness D (in). NaN where the log argument is not positive. */
export function rigidLog10W18(D: number, p: RigidEqParams): number {
  const d75 = D ** 0.75;
  const arg = (p.Sc * p.Cd * (d75 - 1.132)) / (215.63 * p.J * (d75 - 18.42 / (p.Ec / p.k) ** 0.25));
  return p.ZR * p.S0 + 7.35 * Math.log10(D + 1) - 0.06 + Math.log10(p.deltaPSI / (4.5 - 1.5)) / (1 + 1.624e7 / (D + 1) ** 8.46) + (4.22 - 0.32 * p.pt) * Math.log10(arg);
}

/** Required PCC slab thickness D (in) for W18 18-kip ESALs, by bisection on the physical (increasing) branch. */
export function solveSlabThickness(W18: number, p: RigidEqParams): { D: number; belowRange: boolean } {
  need(W18 > 0 && Number.isFinite(W18), `W18 must be greater than 0 (got ${W18})`);
  const c = 18.42 / (p.Ec / p.k) ** 0.25;
  const lo = Math.max(1.132, c) ** (4 / 3) + 0.01;
  const r = solveIncreasing((d) => rigidLog10W18(d, p), Math.log10(W18), lo, 40, 0.05);
  return { D: r.x, belowRange: r.belowRange };
}

/** The rigid equation with numbers substituted at D, as one step string. */
export function rigidEquationStep(D: number, p: RigidEqParams): string {
  const d75 = D ** 0.75, c = 18.42 / (p.Ec / p.k) ** 0.25;
  const t1 = p.ZR * p.S0, t2 = 7.35 * Math.log10(D + 1), num = Math.log10(p.deltaPSI / 3), den = 1 + 1.624e7 / (D + 1) ** 8.46;
  const arg = (p.Sc * p.Cd * (d75 - 1.132)) / (215.63 * p.J * (d75 - c)), f = 4.22 - 0.32 * p.pt;
  const tot = t1 + t2 - 0.06 + num / den + f * Math.log10(arg);
  return `log10(W18) = ZR·S0 + 7.35·log10(D+1) − 0.06 + log10[ΔPSI/(4.5−1.5)] / [1 + 1.624×10^7/(D+1)^8.46] + (4.22 − 0.32·pt)·log10{S'c·Cd·(D^0.75 − 1.132) / [215.63·J·(D^0.75 − 18.42/(Ec/k)^0.25)]} ` +
    `= ${sgn(p.ZR)}×${fx(p.S0, 2)} + 7.35·log10(${fx(D + 1)}) − 0.06 + log10(${fx(p.deltaPSI, 2)}/3.0)/[1 + 1.624×10^7/${fx(D + 1)}^8.46] + (4.22 − 0.32×${p.pt})·log10{${fx(p.Sc, 0)}×${fx(p.Cd, 2)}×(${fx(D)}^0.75 − 1.132) / [215.63×${fx(p.J, 2)}×(${fx(D)}^0.75 − 18.42/(${fx(p.Ec, 0)}/${fx(p.k, 1)})^0.25)]} ` +
    `= ${sgn(t1)} + ${fx(t2)} − 0.06 + ${sgn(num, 4)}/${fx(den, 4)} + ${fx(f, 2)}×log10(${fx(arg, 4)}) = ${fx(tot, 4)} → W18 = 10^${fx(tot, 4)} = ${fmtInt(10 ** tot)}`;
}

export type RigidType = "JPCP_JRCP" | "CRCP";
export type ShoulderType = "asphalt" | "tied_pcc";
/** FHWA NHI-05-037 Table C-4 (AASHTO 1993 Table 2.6): load transfer coefficient J ranges. */
export function loadTransferJ(type: RigidType, shoulder: ShoulderType, loadTransferDevices = true): { min: number; max: number; value: number; detail: string } {
  let r: [number, number];
  if (type === "CRCP") r = shoulder === "asphalt" ? [2.9, 3.2] : [2.3, 2.9];
  else if (shoulder === "asphalt") r = loadTransferDevices ? [3.2, 3.2] : [3.8, 4.4];
  else r = loadTransferDevices ? [2.5, 3.1] : [3.6, 4.2];
  const value = (r[0] + r[1]) / 2;
  const what = `${type === "CRCP" ? "CRCP" : `JPCP/JRCP ${loadTransferDevices ? "with" : "without"} load-transfer devices (dowels)`}, ${shoulder === "asphalt" ? "asphalt (or no) shoulder" : "tied PCC shoulder"}`;
  return { min: r[0], max: r[1], value, detail: `J (FHWA NHI-05-037 Table C-4): ${what} → ${r[0] === r[1] ? fx(value, 1) : `${r[0]}–${r[1]}, midpoint ${fx(value, 2)} (use the higher end for low k, high thermal coefficient or large temperature swings)`}` };
}

export interface RigidInput {
  units?: Units;
  W18: number;
  reliability: number;
  S0?: number; // default 0.35
  deltaPSI?: number; p0?: number; pt?: number; // p0 default 4.5, pt default 2.5
  Sc: number; // concrete modulus of rupture S'c: psi (US) or MPa (SI)
  Ec: number; // concrete elastic modulus: psi (US) or MPa (SI)
  k?: number; // effective modulus of subgrade reaction: pci (US) or MPa/m (SI)
  MR?: number; // roadbed MR (psi or MPa) → k = MR/19.4 pci for a slab directly on the roadbed
  J?: number;
  pavementType?: RigidType; shoulder?: ShoulderType; loadTransferDevices?: boolean;
  Cd?: number;
  drainageQuality?: DrainageQuality; saturationExposure?: SaturationExposure;
  roundTo?: number; // in (US, default 0.5) or mm (SI, default 10)
}

/** AASHTO 1993 rigid pavement slab thickness. */
export function designRigid(inp: RigidInput) {
  const units = inp.units ?? "US";
  const si = units === "SI";
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  need(Number.isFinite(inp.W18) && inp.W18 > 0, `W18 (design ESAL) must be greater than 0 (got ${inp.W18})`);
  const ZR = zrFromReliability(inp.reliability);
  const S0 = standardDeviation(inp.S0, 0.35, 0.3, 0.4, "rigid", notes);
  const sv = serviceability(inp, 4.5, 3.0, "rigid");
  need(sv.pt >= 1.5 && sv.pt <= 4.5, `Terminal serviceability pt must be between 1.5 and 4.5 (got ${sv.pt})`);
  if (inp.deltaPSI !== undefined && inp.pt === undefined) notes.push("pt not given: 2.5 used in the (4.22 − 0.32·pt) term.");
  const psi = (x: number) => (si ? x * PSI_PER_MPA : x);
  need(inp.Sc > 0, `Modulus of rupture S'c must be greater than 0 (got ${inp.Sc})`);
  need(inp.Ec > 0, `Concrete modulus Ec must be greater than 0 (got ${inp.Ec})`);
  const Sc = psi(inp.Sc), Ec = psi(inp.Ec);
  if (Sc < 400 || Sc > 1000) notes.push(`S'c = ${fx(Sc, 0)} psi is outside the usual 500–900 psi (3.4–6.2 MPa) range; check units.`);
  if (Ec < 2e6 || Ec > 8e6) notes.push(`Ec = ${fx(Ec, 0)} psi is outside the usual 3–6 million psi range; check units.`);
  steps.push(`S'c = ${fx(Sc, 0)} psi (${fx(Sc / PSI_PER_MPA, 2)} MPa); Ec = ${fx(Ec, 0)} psi (${fx(Ec / PSI_PER_MPA, 0)} MPa)`);
  let k: number;
  if (inp.k !== undefined) {
    need(inp.k > 0, `k must be greater than 0 (got ${inp.k})`);
    k = si ? inp.k / MPA_PER_M_PER_PCI : inp.k;
    steps.push(`k = ${fx(k, 1)} pci (${fx(k * MPA_PER_M_PER_PCI, 1)} MPa/m)`);
  } else {
    need(inp.MR !== undefined && inp.MR > 0, "Give the effective modulus of subgrade reaction k (pci, or MPa/m with units SI), or the roadbed MR for a slab placed directly on the subgrade.");
    const MRp = psi(inp.MR!);
    k = MRp / 19.4;
    steps.push(`No subbase: k = MR/19.4 = ${fx(MRp, 0)}/19.4 = ${fx(k, 1)} pci (${fx(k * MPA_PER_M_PER_PCI, 1)} MPa/m) (AASHTO 1993 Part II Sec 3.2.1)`);
    notes.push("k = MR/19.4 applies to a slab directly on the roadbed (no subbase, no loss of support). With a subbase, find the composite k from AASHTO Figure 3.3 and correct for loss of support (Figure 3.6).");
  }
  let J: number;
  if (inp.J !== undefined) { need(inp.J > 0 && inp.J <= 5, `J must be between 0 and 5 (got ${inp.J})`); J = inp.J; steps.push(`J = ${J} (given)`); }
  else {
    const g = loadTransferJ(inp.pavementType ?? "JPCP_JRCP", inp.shoulder ?? "asphalt", inp.loadTransferDevices ?? true);
    J = g.value; steps.push(g.detail);
  }
  let Cd = 1.0;
  if (inp.Cd !== undefined) { need(inp.Cd > 0 && inp.Cd <= 1.5, `Cd must be between 0 and 1.5 (got ${inp.Cd})`); Cd = inp.Cd; steps.push(`Cd = ${Cd} (given)`); }
  else if (inp.drainageQuality && inp.saturationExposure) { const d = drainageCoefficientCd(inp.drainageQuality, inp.saturationExposure); Cd = d.value; steps.push(d.detail); }
  else steps.push("Cd = 1.00 (default: give drainage quality and exposure, or Cd)");
  steps.push(`ZR = ${fx(ZR, 3)} for R = ${inp.reliability} %; S0 = ${S0}; ${sv.step}; pt = ${sv.pt}`);
  const p: RigidEqParams = { ZR, S0, deltaPSI: sv.deltaPSI, pt: sv.pt, Sc, Cd, J, Ec, k };
  const sol = solveSlabThickness(inp.W18, p);
  const D = sol.D;
  steps.push(`Solve for D by bisection so that the equation gives W18 = ${fmtInt(inp.W18)} (log10 W18 = ${fx(Math.log10(inp.W18), 4)}):`);
  steps.push(rigidEquationStep(D, p));
  const stepIn = si ? (inp.roundTo ?? 10) / MM_PER_IN : inp.roundTo ?? 0.5;
  need(stepIn > 0, "roundTo must be greater than 0");
  const Dd = ceilTo(D, stepIn);
  steps.push(`Required D = ${fx(D, 2)} in (${fx(D * MM_PER_IN, 0)} mm) → design slab ${si ? `${fx(Dd * MM_PER_IN, 0)} mm (${fx(Dd, 2)} in)` : `${fx(Dd, 1)} in (${fx(Dd * MM_PER_IN, 0)} mm)`}, rounded up to ${si ? `${fx(stepIn * MM_PER_IN, 0)} mm` : `${stepIn} in`}`);
  if (sol.belowRange) notes.push("The traffic is so low that the equation is satisfied at any practical thickness; use the agency minimum slab thickness.");
  if (Dd < 6) notes.push("Slab thinner than 6 in (150 mm): check the agency minimum slab thickness.");
  checks.push({ name: "Design slab ≥ required D", ok: Dd >= D - 1e-9, detail: `${fx(Dd, 2)} in ≥ ${fx(D, 2)} in` });
  notes.push("AASHTO 1993 rigid equation (NCDOT Pavement Design Manual p.2; FHWA NHI-05-037). The constant is 1.624×10^7 (the FHWA web page misprints it as 1.64×10^7). Many state DOTs now use AASHTOWare Pavement ME for major highways.");
  return { units, W18: inp.W18, reliability: inp.reliability, ZR, S0, deltaPSI: sv.deltaPSI, pt: sv.pt, Sc_psi: Sc, Ec_psi: Ec, k_pci: k, k_MPa_per_m: k * MPA_PER_M_PER_PCI, J, Cd, D_required_in: D, D_required_mm: D * MM_PER_IN, D_in: Dd, D_mm: Dd * MM_PER_IN, ok: true, steps, checks, notes };
}

// ---------------- traffic: cumulative ESAL / msa ----------------

/** Cumulative growth factor [(1+r)^n − 1]/r for r in % per year (= n when r = 0). */
export function growthFactor(ratePercent: number, years: number): number {
  const r = ratePercent / 100;
  return r === 0 ? years : ((1 + r) ** years - 1) / r;
}

/** RHD Pavement Design Guide 2005 Table 3: equivalence factors (ESA per vehicle). Cars, auto-rickshaws and rickshaws: 0. */
export const RHD_EQUIVALENCE_FACTORS: Record<string, number> = { "large truck": 4.8, "medium truck": 4.62, "small truck": 1.0, "large bus": 1.0, "mini bus": 0.5 };
/** LGED feeder-road design equivalence factors. */
export const LGED_EQUIVALENCE_FACTORS: Record<string, number> = { truck: 1.0, bus: 0.5, "mini bus": 0.2 };
/** RHD 2005 Table 4: 20-year cumulative factors (first-year annual ESA × factor), and the growth rates behind them. */
export const RHD_CUMULATIVE = { National: { rate: 10, years: 20, factor: 57.3 }, Regional: { rate: 7, years: 20, factor: 41.0 } } as const;
const LIGHT_VEHICLES = /^(car|cars|jeep|microbus|micro bus|auto rickshaw|autorickshaw|cng|tempo|rickshaw|rickshaws|motorcycle|motor cycle|bicycle|van|rickshaw van)$/;

const vehicleKey = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/buses\b/, "bus").replace(/trucks\b/, "truck").replace(/^minibus$/, "mini bus").replace(/^heavy truck$/, "large truck").replace(/^light truck$/, "small truck");

/** Preset equivalence factor for a vehicle class name, or undefined. */
export function presetEquivalenceFactor(method: "RHD" | "LGED", name: string): number | undefined {
  const k = vehicleKey(name);
  if (LIGHT_VEHICLES.test(k)) return 0;
  if (method === "RHD") return RHD_EQUIVALENCE_FACTORS[k === "bus" ? "large bus" : k];
  return LGED_EQUIVALENCE_FACTORS[k === "large bus" ? "bus" : k];
}

/** IRC:37-2018 Table 4.2 indicative VDF by initial commercial vehicles per day (a value on a band boundary uses the higher band). */
export function ircIndicativeVDF(cvpd: number, terrain: "plain" | "hilly" = "plain"): { vdf: number; band: string } {
  const hilly = terrain === "hilly";
  if (cvpd < 150) return { vdf: hilly ? 0.6 : 1.7, band: "0–150 CVPD" };
  if (cvpd < 1500) return { vdf: hilly ? 1.7 : 3.9, band: "150–1500 CVPD" };
  return { vdf: hilly ? 2.8 : 5.0, band: "more than 1500 CVPD" };
}

export type IrcLaneCase = "single_lane" | "intermediate_lane" | "two_lane" | "four_lane_undivided" | "dual_2_lane" | "dual_3_lane" | "dual_4_lane";
/** IRC:37-2018 Sec 4.5 (p.17) lane distribution: factor and whether it applies to two-way or one-direction traffic. */
export const IRC_LANE_FACTORS: Record<IrcLaneCase, { factor: number; directional: boolean; label: string }> = {
  single_lane: { factor: 1.0, directional: false, label: "single-lane road: total two-way traffic" },
  intermediate_lane: { factor: 0.75, directional: false, label: "intermediate lane (5.5 m): 75 % of two-way traffic" },
  two_lane: { factor: 0.5, directional: false, label: "two-lane single carriageway: 50 % of two-way traffic" },
  four_lane_undivided: { factor: 0.4, directional: false, label: "four-lane undivided: 40 % of two-way traffic" },
  dual_2_lane: { factor: 0.75, directional: true, label: "dual two-lane carriageway: 75 % of one-direction traffic" },
  dual_3_lane: { factor: 0.6, directional: true, label: "dual three-lane carriageway: 60 % of one-direction traffic" },
  dual_4_lane: { factor: 0.45, directional: true, label: "dual four-lane carriageway: 45 % of one-direction traffic" },
};
/** AASHTO 1993 Part II Sec 2.1.2 lane distribution DL by lanes in each direction: [min, max]. */
export const AASHTO_LANE_FACTORS: Record<number, [number, number]> = { 1: [1.0, 1.0], 2: [0.8, 1.0], 3: [0.6, 0.8], 4: [0.5, 0.75] };

/** Fourth-power approximation for a SINGLE axle: LEF ≈ (P/18 kip)^4 (80 kN). An approximation, not the AASHTO table. */
export const lefFourthPower = (singleAxleKip: number) => (singleAxleKip / 18) ** 4;

/**
 * AASHTO flexible load equivalency factor (the equation behind AASHTO 1993 Appendix D Tables D.1–D.6, as given by Huang):
 * log10(Wtx/Wt18) = 4.79·log10(18+1) − 4.79·log10(Lx+L2) + 4.33·log10(L2) + Gt/βx − Gt/β18,
 * Gt = log10[(4.2−pt)/(4.2−1.5)], βx = 0.40 + 0.081·(Lx+L2)^3.23/[(SN+1)^5.19·L2^3.23]; LEF = Wt18/Wtx. Lx in kip.
 */
export function aashtoFlexibleLEF(LxKip: number, axle: "single" | "tandem" | "tridem", SN = 5, pt = 2.5): number {
  need(LxKip > 0, `Axle load must be greater than 0 (got ${LxKip})`);
  need(SN > 0 && SN <= 10, `SN for the LEF must be between 0 and 10 (got ${SN})`);
  need(pt >= 1.5 && pt < 4.2, `pt for the LEF must be between 1.5 and 4.2 (got ${pt})`);
  const L2 = axle === "single" ? 1 : axle === "tandem" ? 2 : 3;
  const Gt = Math.log10((4.2 - pt) / 2.7);
  const beta = (L: number, l2: number) => 0.4 + (0.081 * (L + l2) ** 3.23) / ((SN + 1) ** 5.19 * l2 ** 3.23);
  const log = 4.79 * Math.log10(19) - 4.79 * Math.log10(LxKip + L2) + 4.33 * Math.log10(L2) + Gt / beta(LxKip, L2) - Gt / beta(18, 1);
  return 10 ** -log;
}

export type TrafficMethod = "generic" | "RHD" | "LGED" | "IRC" | "AASHTO";
export interface AxleLoad { type: "single" | "tandem" | "tridem"; load: number }
export interface TrafficClassInput { name: string; perDay: number; factor?: number; axles?: AxleLoad[] }
export interface TrafficInput {
  method?: TrafficMethod;
  classes?: TrafficClassInput[]; // first-year daily counts per class (two-way unless stated)
  dailyVehicles?: number; // first-year daily commercial vehicles A (with factor F)
  factor?: number; // vehicle damage factor / truck factor F for dailyVehicles
  firstYearESAL?: number; // first-year annual ESAL (instead of daily counts)
  growthRate?: number; // % per year
  designLife?: number; // years
  roadClass?: "National" | "Regional"; // RHD defaults for growth rate
  directional?: number; // D
  lane?: number; // L
  ircLaneCase?: IrcLaneCase;
  lanesPerDirection?: number; // AASHTO DL
  singleLane?: boolean; // LGED: single-lane road → 2 × two-way cumulative ESA
  terrain?: "plain" | "hilly"; // IRC indicative VDF
  yearsToOpening?: number; // x: A = P·(1+r)^x
  axleLoadUnit?: "kN" | "kip";
  lefMethod?: "aashto" | "fourth_power";
  lefSN?: number; lefPt?: number;
}

/** Cumulative design ESAL (standard axles) N = 365·[(1+r)^n − 1]/r·A·D·L·F, with RHD / LGED / IRC / AASHTO presets. */
export function cumulativeESAL(inp: TrafficInput) {
  const method = inp.method ?? "generic";
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  const rhd = method === "RHD" ? RHD_CUMULATIVE[inp.roadClass ?? "Regional"] : undefined;
  need(!inp.roadClass || !!RHD_CUMULATIVE[inp.roadClass], `roadClass must be National or Regional (got ${inp.roadClass})`);
  const r = inp.growthRate ?? rhd?.rate;
  const n = inp.designLife ?? rhd?.years;
  need(r !== undefined, "Give the traffic growth rate in % per year (growthRate).");
  need(n !== undefined, "Give the design life in years (designLife).");
  need(r! >= 0 && r! <= 30, `Growth rate must be between 0 and 30 % per year (got ${r})`);
  need(n! >= 1 && n! <= 60, `Design life must be between 1 and 60 years (got ${n})`);
  const nSources = [inp.classes?.length ? 1 : 0, inp.dailyVehicles !== undefined ? 1 : 0, inp.firstYearESAL !== undefined ? 1 : 0].reduce((a, b) => a + b, 0);
  need(nSources === 1, "Give exactly one of: classes (daily count per vehicle class), dailyVehicles with factor, or firstYearESAL.");
  const GF = growthFactor(r!, n!);
  steps.push(r === 0 ? `Growth factor = n = ${n} (no growth)` : `Growth factor = [(1 + r)^n − 1]/r = [(1 + ${r! / 100})^${n} − 1]/${r! / 100} = ${fx(GF, 3)}`);
  if (rhd && inp.growthRate === undefined) notes.push(`RHD 2005 Table 4: ${inp.roadClass ?? "Regional"} road, ${rhd.rate} %/yr for ${rhd.years} years → cumulative factor ${rhd.factor} (formula ${fx(growthFactor(rhd.rate, rhd.years), 2)}).`);
  const x = inp.yearsToOpening ?? 0;
  need(x >= 0 && x <= 20, `yearsToOpening must be between 0 and 20 (got ${x})`);
  const open = (1 + r! / 100) ** x;
  if (x > 0) steps.push(`Traffic at opening = P·(1 + r)^x = P × (1 + ${r! / 100})^${x} = P × ${fx(open, 4)}`);

  // distribution
  let D = 1, L = 1, mult = 1;
  if (method === "AASHTO") {
    D = 0.5;
    const lanes = inp.lanesPerDirection ?? 1;
    const lf = AASHTO_LANE_FACTORS[lanes];
    need(!!lf, `lanesPerDirection must be 1, 2, 3 or 4 (got ${lanes})`);
    L = lf[1];
    if (inp.lane === undefined && lf[0] !== lf[1]) notes.push(`AASHTO lane distribution for ${lanes} lanes each way is ${lf[0] * 100}–${lf[1] * 100} %; ${lf[1] * 100} % (upper, conservative) used. Give lane to override.`);
  } else if (method === "IRC") {
    const c = IRC_LANE_FACTORS[inp.ircLaneCase ?? "two_lane"];
    need(!!c, `Unknown ircLaneCase "${inp.ircLaneCase}"`);
    D = c.directional ? 0.5 : 1; L = c.factor;
    notes.push(`IRC:37-2018 lane distribution (p.17): ${c.label}.${c.directional ? " D = 0.5 splits two-way counts; set directional = 1 if the counts are already for one direction." : ""}`);
  } else if (method === "RHD") {
    D = 0.5;
    notes.push("RHD 2005: for a single carriageway the design traffic is 0.5 × the two-way commercial flow (D·L = 0.5). Set directional = 1 if the counts are already the design-direction flow.");
  } else if (method === "LGED") {
    if (inp.singleLane) { mult = 2; notes.push("LGED: single-lane road, design traffic = 2 × the two-way cumulative ESA (vehicles share one lane)."); }
  } else notes.push("Generic method: D = L = 1 unless given (counts treated as the design-lane flow).");
  D = inp.directional ?? D; L = inp.lane ?? L;
  need(D > 0 && D <= 1, `Directional factor D must be between 0 and 1 (got ${D})`);
  need(L > 0 && L <= 1, `Lane distribution factor L must be between 0 and 1 (got ${L})`);

  const unit = inp.axleLoadUnit ?? "kN";
  const kip = (v: number) => (unit === "kN" ? v / 4.448222 : v);
  const perClass: { name: string; perDay: number; factor: number; dailyESA: number; cumulative: number }[] = [];
  let A: number, annual: number;
  const tail = `${fx(D, 2)} × ${fx(L, 2)}${mult !== 1 ? ` × ${mult}` : ""}`;
  if (inp.classes?.length) {
    for (const c of inp.classes) {
      need(c.perDay >= 0, `${c.name}: daily count must not be negative`);
      let F = c.factor;
      if (F === undefined && c.axles?.length) {
        const lm = inp.lefMethod ?? "aashto";
        const parts = c.axles.map((a) => {
          if (lm === "fourth_power") { need(a.type === "single", `${c.name}: the fourth-power approximation is for single axles only; use lefMethod aashto for tandem/tridem axles.`); return lefFourthPower(kip(a.load)); }
          return aashtoFlexibleLEF(kip(a.load), a.type, inp.lefSN ?? 5, inp.lefPt ?? 2.5);
        });
        F = parts.reduce((s, v) => s + v, 0);
        steps.push(`${c.name}: F = Σ LEF = ${c.axles.map((a, i) => `${a.type} ${a.load} ${unit} → ${fx(parts[i], 3)}`).join(" + ")} = ${fx(F, 3)} (${lm === "aashto" ? `AASHTO flexible LEF equation, SN ${inp.lefSN ?? 5}, pt ${inp.lefPt ?? 2.5}` : "fourth-power approximation (P/18 kip)^4, not the AASHTO table"})`);
      }
      if (F === undefined && (method === "RHD" || method === "LGED")) F = presetEquivalenceFactor(method, c.name);
      need(F !== undefined, `No equivalence factor for "${c.name}". Give factor (ESA per vehicle) or axle loads${method === "RHD" ? `, or use an RHD class: ${Object.keys(RHD_EQUIVALENCE_FACTORS).join(", ")}` : method === "LGED" ? `, or use an LGED class: ${Object.keys(LGED_EQUIVALENCE_FACTORS).join(", ")}` : ""}.`);
      need(F! >= 0, `${c.name}: factor must not be negative`);
      const daily = c.perDay * open * F!;
      perClass.push({ name: c.name, perDay: c.perDay, factor: F!, dailyESA: daily, cumulative: 365 * GF * daily * D * L * mult });
    }
    A = perClass.reduce((s, c) => s + c.dailyESA, 0);
    steps.push(`Daily ESA A·F = Σ count × factor${x > 0 ? ` × ${fx(open, 4)}` : ""} = ${perClass.map((c) => `${c.perDay}×${c.factor}`).join(" + ")}${x > 0 ? ` (× ${fx(open, 4)})` : ""} = ${fx(A, 2)} ESA/day`);
    annual = 365 * A;
    for (const c of perClass) steps.push(`${c.name}: 365 × ${fx(GF, 3)} × ${c.perDay} × ${c.factor}${x > 0 ? ` × ${fx(open, 4)}` : ""} × ${tail} = ${fmtInt(c.cumulative)}`);
  } else if (inp.dailyVehicles !== undefined) {
    need(inp.dailyVehicles > 0, `dailyVehicles must be greater than 0 (got ${inp.dailyVehicles})`);
    let F = inp.factor;
    if (F === undefined && method === "IRC") { const v = ircIndicativeVDF(inp.dailyVehicles, inp.terrain ?? "plain"); F = v.vdf; notes.push(`IRC:37-2018 indicative VDF ${v.vdf} (${v.band}, ${inp.terrain ?? "plain"} terrain). Use axle-load survey VDF where available.`); }
    need(F !== undefined && F > 0, "Give the vehicle damage factor / truck factor F (factor) for dailyVehicles.");
    A = inp.dailyVehicles * open * F!;
    annual = 365 * A;
    steps.push(`A·F = ${inp.dailyVehicles}${x > 0 ? ` × ${fx(open, 4)}` : ""} × ${F} = ${fx(A, 2)} ESA/day`);
  } else {
    need(inp.firstYearESAL! > 0, `firstYearESAL must be greater than 0 (got ${inp.firstYearESAL})`);
    annual = inp.firstYearESAL! * open;
    A = annual / 365;
    steps.push(`First-year ESAL = ${fmtInt(inp.firstYearESAL!)}${x > 0 ? ` × ${fx(open, 4)} = ${fmtInt(annual)}` : ""} per year`);
  }
  const designLaneFirstYear = annual * D * L * mult;
  const N = designLaneFirstYear * GF;
  steps.push(`N = (365·A·F) × GF × D × L${mult !== 1 ? " × 2" : ""} = ${fmtInt(annual)} × ${fx(GF, 3)} × ${tail} = ${fmtInt(N)} ESAL = ${fx(N / 1e6, 3)} msa`);
  checks.push({ name: "Design traffic positive", ok: N > 0, detail: `${fx(N / 1e6, 3)} msa` });
  notes.push("One ESAL (standard axle) = 18,000 lb (80 kN, 8,160 kg) single axle with dual tyres. Sources: IRC:37-2018 Eq. 4.2; AASHTO 1993 Part II Sec 2.1; RHD Pavement Design Guide 2005 Tables 3–4; LGED feeder-road design.");
  return { method, growthRate: r!, designLife: n!, growthFactor: GF, openingFactor: open, dailyESA: A, firstYearAnnualESAL: annual, directional: D, lane: L, multiplier: mult, designLaneFirstYearESAL: designLaneFirstYear, cumulativeESAL: N, msa: N / 1e6, classes: perClass, steps, checks, notes };
}

// ---------------- Bangladesh RHD Pavement Design Guide (2005) catalogue ----------------

/** RHD 2005 Table 1: minimum soaked CBR (%) of pavement materials. */
export const RHD_MIN_CBR = { "Base Type I": 80, "Base Type II": 50, "Sub-base": 25, "Improved subgrade": 8, Subgrade: 5, Embankment: 3 } as const;

/** RHD 2005 Table 5 asphalt base course (mm) by design traffic: [lower bound msa, thickness]; wearing course is always 40 mm. */
const RHD_ASPHALT_BASE: [number, number][] = [[60, 155], [40, 140], [30, 125], [25, 110], [17, 105], [15, 95], [11, 90], [9, 80], [7, 70], [6, 65], [5, 60], [4, 55], [3, 45], [0, 35]];
/** Table 5 granular road base (mm): [lower bound msa, Type I, Type II]; not applicable at 30 msa and above. */
const RHD_GRANULAR_BASE: [number, number, number][] = [[11, 250, 300], [4, 200, 250], [3, 175, 200], [0, 150, 175]];
/** Table 5 granular sub-base (mm) on a CBR 5 % subgrade: [lower bound msa, thickness]. */
const RHD_SUBBASE_CBR5: [number, number][] = [[30, 300], [17, 250], [4, 200], [3, 175], [0, 150]];

function band<T>(rows: [number, ...T[]][], msa: number, upperTop: number): { row: [number, ...T[]]; label: string } {
  for (let i = 0; i < rows.length; i++) {
    if (msa >= rows[i][0]) {
      const hi = i === 0 ? upperTop : rows[i - 1][0];
      return { row: rows[i], label: rows[i][0] === 0 ? `< ${hi} msa` : `${rows[i][0]}–${hi} msa` };
    }
  }
  return { row: rows[rows.length - 1], label: "" };
}

export type ImprovedSubgradeSource = "appendix" | "table6";

/**
 * Improved subgrade (mm) to bring the subgrade to CBR 5 %. table6: RHD Table 6 (250 / 150 / 100 mm on CBR 2 / 3 / 4 %).
 * appendix (default, conservative): Appendix 1 (300 / 250 / 200 mm on CBR 3 / 4 / 5 %), as used in the Appendix 2 example.
 * Between listed CBRs the lower listed CBR governs. null = CBR < 2 %: remove and replace.
 */
export function rhdImprovedSubgrade(cbr: number, source: ImprovedSubgradeSource = "appendix"): { thickness: number | null; detail: string } {
  need(Number.isFinite(cbr) && cbr > 0, `Subgrade CBR must be greater than 0 % (got ${cbr})`);
  if (cbr < 2) return { thickness: null, detail: `Subgrade CBR ${cbr} % < 2 %: remove and replace the soft soil (RHD Table 6); the catalogue does not cover it.` };
  if (source === "table6") {
    const t = cbr < 3 ? 250 : cbr < 4 ? 150 : cbr < 5 ? 100 : 0;
    return { thickness: t, detail: `Table 6: subgrade CBR ${cbr} % → improved subgrade ${t} mm${t ? " to reach CBR 5 %" : " (CBR ≥ 5 %, none needed)"}` };
  }
  if (cbr >= 8) return { thickness: 0, detail: `Subgrade CBR ${cbr} % ≥ 8 % (the improved-subgrade material minimum, Table 1): no improved subgrade needed` };
  const t = cbr < 4 ? 300 : cbr < 5 ? 250 : 200;
  const extra = cbr < 3 ? " (Appendix 1 has no value for CBR 2 %; Table 6 gives 250 mm, but 300 mm, the Appendix 1 value for 3 %, is used so a weaker subgrade never gets less)" : cbr >= 5 ? " (Appendix 1 value for CBR 5 %, applied up to CBR 8 %; Table 6 would need none)" : "";
  return { thickness: t, detail: `Appendix 1: subgrade CBR ${cbr} % → improved subgrade ${t} mm${extra}` };
}

export interface RhdInput {
  msa: number; // design traffic, million standard axles (8,160 kg)
  subgradeCBR: number; // soaked CBR %
  baseType?: "I" | "II"; // granular road base, default Type I
  improvedSubgradeSource?: ImprovedSubgradeSource;
  roadClass?: "National" | "Regional";
}

/** RHD Pavement Design Guide (2005) flexible pavement catalogue (Table 5). */
export function rhdFlexibleDesign(inp: RhdInput) {
  const steps: string[] = [], checks: Check[] = [], notes: string[] = [];
  need(Number.isFinite(inp.msa) && inp.msa > 0, `Design traffic must be greater than 0 msa (got ${inp.msa})`);
  need(inp.msa <= 80, `Design traffic ${inp.msa} msa is above the RHD 2005 catalogue limit of 80 msa: design by AASHTO 1993 (pavement_flexible_aashto) or TRL ORN 31.`);
  const cbr = inp.subgradeCBR;
  need(Number.isFinite(cbr) && cbr > 0, `Subgrade CBR must be greater than 0 % (got ${cbr})`);
  const baseType = inp.baseType ?? "I";
  const src = inp.improvedSubgradeSource ?? "appendix";
  const msa = inp.msa;

  const ab = band(RHD_ASPHALT_BASE, msa, 80);
  steps.push(`Design traffic ${msa} msa → Table 5 band ${ab.label}: asphalt wearing course 40 mm + asphalt base course ${ab.row[1]} mm = ${40 + ab.row[1]} mm dense bituminous surfacing`);
  let granular: number | null = null;
  if (msa < 30) {
    const gb = band(RHD_GRANULAR_BASE, msa, 30);
    granular = baseType === "I" ? gb.row[1] : gb.row[2];
    steps.push(`Granular road base Type ${baseType} (Table 5, ${gb.label}): ${granular} mm (material CBR ≥ ${baseType === "I" ? 80 : 50} %)`);
  } else steps.push(`Design traffic ≥ 30 msa: granular road base is not applicable (Table 5 "N/A")`);
  checks.push({ name: "Granular road base applicable (< 30 msa)", ok: granular !== null, detail: granular !== null ? `${msa} msa < 30 msa` : `${msa} msa ≥ 30 msa: use a cement-bound road base ("Refer to BRRL"), or design strategic National roads by AASHTO 1993 / ORN 31 (RHD guide p.9)` });

  const imp = rhdImprovedSubgrade(cbr, src);
  steps.push(imp.detail);
  checks.push({ name: "Subgrade CBR ≥ 2 % (RHD Table 6)", ok: imp.thickness !== null, detail: imp.thickness !== null ? `CBR ${cbr} %` : "CBR < 2 %: remove and replace" });
  let subbase: number, sbDetail: string;
  if (cbr > 25) { subbase = 0; sbDetail = `Subgrade CBR ${cbr} % > 25 %: no sub-base (Table 5)`; }
  else if (cbr >= 8) { subbase = 150; sbDetail = `Subgrade CBR ${cbr} % (8–25 % column): sub-base 150 mm (Table 5)`; }
  else { const sb = band(RHD_SUBBASE_CBR5, msa, 80); subbase = sb.row[1]; sbDetail = `Sub-base on a CBR 5 % ${imp.thickness ? "(improved) " : ""}subgrade (Table 5, ${sb.label}): ${subbase} mm (material CBR ≥ 25 %)`; }
  steps.push(sbDetail);

  const layers = [
    { layer: "Asphalt wearing course", thickness_mm: 40 as number | null, spec: "dense bituminous surfacing" },
    { layer: "Asphalt base course", thickness_mm: ab.row[1] as number | null, spec: "dense bituminous surfacing" },
    { layer: `Granular road base Type ${baseType}`, thickness_mm: granular, spec: granular === null ? "N/A ≥ 30 msa: cement-bound base (refer to BRRL)" : `CBR ≥ ${baseType === "I" ? 80 : 50} %` },
    { layer: "Granular sub-base", thickness_mm: subbase as number | null, spec: "CBR ≥ 25 %" },
    { layer: "Improved subgrade", thickness_mm: imp.thickness, spec: imp.thickness === null ? "remove and replace (CBR < 2 %)" : "CBR ≥ 8 %" },
  ];
  const total = layers.reduce((s, l) => s + (l.thickness_mm ?? 0), 0);
  steps.push(`Total pavement thickness above the subgrade = ${layers.filter((l) => l.thickness_mm).map((l) => l.thickness_mm).join(" + ")} = ${total} mm`);

  notes.push("Bangladesh RHD Pavement Design Guide (April 2005), Table 5 catalogue for flexible pavements: https://rhd.gov.bd/Documents/RoadDesignAndSafety/PavemantDesignGuideforRHD/Index.pdf");
  notes.push("Design life 20 years; traffic growth 10 %/yr (National) or 7 %/yr (Regional), cumulative factors 57.3 and 41.0 (Table 4); standard axle 8,160 kg. Compute msa with the traffic_esal tool (method RHD).");
  notes.push("Band boundaries: a design traffic exactly on a boundary uses the higher (thicker) band; 80 msa is the top of the catalogue.");
  notes.push(`Minimum soaked CBR (Table 1): Base Type I ≥ 80 %, Base Type II ≥ 50 %, sub-base ≥ 25 %, improved subgrade ≥ 8 %, subgrade ≥ 5 %, embankment ≥ 3 %.`);
  if (src === "appendix") notes.push("Improved subgrade: Table 6 (250/150/100 mm on CBR 2/3/4 %) conflicts with Appendix 1 (300/250/200 mm on CBR 3/4/5 %; the Appendix 2 example uses 300 mm on 3 %). The larger Appendix 1 values are used; set improvedSubgradeSource to table6 for Table 6.");
  else notes.push("Improved subgrade from Table 6. Appendix 1 gives larger values (300/250/200 mm on CBR 3/4/5 %) and is used in the Appendix 2 example; the default (appendix) is more conservative.");
  notes.push("Standard designs (Appendix 1): 5.5 m road: 40 mm bituminous carpet + 12 mm seal coat, 200 mm base Type I, 200 mm sub-base; 3.7 m road: 40 mm carpet + 7 mm seal coat, 150 mm base, 150 mm sub-base.");
  if (inp.roadClass === "National") notes.push("Strategic National roads should be designed by AASHTO 1993 with RHD traffic (pavement_flexible_aashto), or TRL ORN 31 (RHD guide p.9).");
  notes.push("For LGED rural roads use LGED's own design standards; for USA roads use AASHTO 1993.");
  return { msa, subgradeCBR: cbr, baseType, improvedSubgradeSource: src, layers, asphaltTotal_mm: 40 + ab.row[1], total_mm: total, ok: checks.every((c) => c.ok), steps, checks, notes };
}
