/**
 * Stormwater and open-channel / pipe hydraulics.
 *  - Rational method: Q = C·i·A/360 (m³/s, mm/h, ha) or Q = C·i·A (cfs, in/h, acres); composite C by area weighting;
 *    frequency factor Cf (HEC-22: 1.1 for 25-yr, 1.2 for 50-yr, 1.25 for 100-yr; C·Cf ≤ 1).
 *  - Time of concentration (Kirpich): tc = 0.0078·L^0.77·S^−0.385 (min, L in ft) = 0.0195·L^0.77·S^−0.385 (L in m).
 *  - Manning: V = (k/n)·R^(2/3)·S^(1/2), k = 1 (SI) or 1.486 (US); circular pipes full or part full
 *    (θ = 2·acos(1 − 2y/D), A = D²(θ − sinθ)/8, P = Dθ/2), rectangular and trapezoidal channels; normal depth by bisection;
 *    smallest standard pipe for a design flow.
 * Sources: FHWA HEC-22 Urban Drainage Design Manual (3rd ed.) Eq. 3-1, Table 3-2 (Cf), Eq. 5-5; Examples 3-3 and 5-1 are
 * reproduced in tests. Rainfall intensity must come from the local IDF curve (USA: NOAA Atlas 14 PFDS) or the user.
 */
export type Units = "SI" | "US";

export interface RationalInput { units?: Units; areas: { area: number; C: number; label?: string }[]; intensity: number; returnPeriod?: number }
export function rationalMethod(inp: RationalInput) {
  const us = inp.units === "US";
  if (!inp.areas?.length) throw new Error("Give at least one catchment area with its runoff coefficient C");
  if (!(inp.intensity > 0)) throw new Error("Give the rainfall intensity for the design storm and time of concentration");
  for (const a of inp.areas) { if (!(a.area > 0)) throw new Error("Areas must be positive"); if (!(a.C > 0 && a.C <= 1)) throw new Error("Runoff coefficient C must be between 0 and 1"); }
  const A = inp.areas.reduce((s, a) => s + a.area, 0);
  const C = inp.areas.reduce((s, a) => s + a.area * a.C, 0) / A;
  const rp = inp.returnPeriod ?? 10;
  const Cf = rp >= 100 ? 1.25 : rp >= 50 ? 1.2 : rp >= 25 ? 1.1 : 1.0;
  const Ceff = Math.min(1, C * Cf);
  const Q = us ? Ceff * inp.intensity * A : (Ceff * inp.intensity * A) / 360;
  const [qU, iU, aU] = us ? ["cfs", "in/h", "acres"] : ["m³/s", "mm/h", "ha"];
  const steps = [
    ...(inp.areas.length > 1 ? [`Composite C = Σ(C·A)/ΣA = ${inp.areas.map((a) => `${a.C}×${a.area}`).join(" + ")} / ${A} = ${C.toFixed(3)}`] : [`C = ${C}`]),
    ...(Cf > 1 ? [`Frequency factor Cf = ${Cf} for the ${rp}-year storm (HEC-22 Table 3-2): C·Cf = ${(C * Cf).toFixed(3)}${C * Cf > 1 ? " → limited to 1.0" : ""}`] : []),
    us ? `Q = C·i·A = ${Ceff.toFixed(3)} × ${inp.intensity} × ${A} = ${Q.toFixed(2)} ${qU}` : `Q = C·i·A/360 = ${Ceff.toFixed(3)} × ${inp.intensity} × ${A} / 360 = ${Q.toFixed(3)} ${qU}`,
  ];
  const notes = [`Rational method is intended for small catchments (HEC-22: up to about 80 ha / 200 acres). Intensity i must be for a duration equal to the time of concentration, from the local IDF curve${us ? " (NOAA Atlas 14, hdsc.nws.noaa.gov/pfds)" : ""}.`];
  if ((us ? A * 0.4047 : A) > 80) notes.push("This catchment is larger than the usual limit of the rational method; use a hydrograph method (e.g. NRCS TR-55 / TR-20).");
  return { units: inp.units ?? "SI", area: A, C, Cf, Ceff, intensity: inp.intensity, Q, unitsQ: qU, unitsI: iU, unitsA: aU, steps, notes };
}

/** Kirpich time of concentration (minutes); L = flow length, S = average slope (m/m). */
export function kirpich(length: number, slope: number, units: Units = "SI") {
  if (!(length > 0 && slope > 0)) throw new Error("Flow length and slope must be positive");
  const tc = (units === "US" ? 0.0078 : 0.0195) * length ** 0.77 * slope ** -0.385;
  return { tc, step: `Kirpich: tc = ${units === "US" ? "0.0078" : "0.0195"} × ${length}^0.77 × ${slope}^−0.385 = ${tc.toFixed(1)} min` };
}

// ---------- Manning ----------
export type Section = { shape: "circular"; diameter: number } | { shape: "rectangular"; width: number } | { shape: "trapezoidal"; bottomWidth: number; sideSlope: number /* H:1V */ };
export function flowArea(sec: Section, y: number) {
  if (sec.shape === "circular") {
    const D = sec.diameter, yy = Math.min(Math.max(y, 0), D);
    const th = 2 * Math.acos(1 - (2 * yy) / D);
    return { A: (D * D * (th - Math.sin(th))) / 8, P: (D * th) / 2, T: D * Math.sin(th / 2) };
  }
  if (sec.shape === "rectangular") return { A: sec.width * y, P: sec.width + 2 * y, T: sec.width };
  const { bottomWidth: b, sideSlope: z } = sec;
  return { A: (b + z * y) * y, P: b + 2 * y * Math.sqrt(1 + z * z), T: b + 2 * z * y };
}
export function manningQ(sec: Section, y: number, n: number, S: number, units: Units = "SI") {
  if (!(n > 0 && S > 0)) throw new Error("Manning's n and the slope must be positive");
  const { A, P, T } = flowArea(sec, y);
  const R = P > 0 ? A / P : 0;
  const k = units === "US" ? 1.486 : 1;
  const V = (k / n) * R ** (2 / 3) * Math.sqrt(S);
  return { A, P, R, T, V, Q: V * A };
}
/** Normal depth for a flow (bisection). For part-full pipes the depth is taken on the rising limb (y/D ≤ 0.938). */
export function normalDepth(sec: Section, Q: number, n: number, S: number, units: Units = "SI") {
  const top = sec.shape === "circular" ? 0.938 * sec.diameter : 100;
  if (manningQ(sec, top, n, S, units).Q < Q) return null; // does not fit
  let lo = 0, hi = top;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (manningQ(sec, mid, n, S, units).Q < Q) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export const STANDARD_PIPES = { SI: [150, 200, 250, 300, 375, 450, 525, 600, 675, 750, 825, 900, 1050, 1200, 1350, 1500, 1650, 1800, 2100, 2400], US: [8, 10, 12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48, 54, 60, 66, 72, 84, 96] };

export interface PipeSizeInput { Q: number; slope: number; n?: number; units?: Units; purpose?: "storm" | "sanitary"; maxDepthRatio?: number }
/** Smallest standard pipe that carries Q at the given slope (full for storm drains, y/D ≤ maxDepthRatio otherwise). */
export function sizePipe(inp: PipeSizeInput) {
  const units = inp.units ?? "SI", us = units === "US", n = inp.n ?? 0.013;
  const purpose = inp.purpose ?? "storm";
  const ratio = inp.maxDepthRatio ?? (purpose === "storm" ? 1 : 0.8);
  const vMin = purpose === "storm" ? (us ? 3 : 0.9) : us ? 2 : 0.6;
  const toLen = (d: number) => (us ? d / 12 : d / 1000); // in → ft, mm → m
  const steps: string[] = [], checks: { name: string; ok: boolean; detail: string }[] = [];
  for (const d of STANDARD_PIPES[units]) {
    const sec: Section = { shape: "circular", diameter: toLen(d) };
    const full = manningQ(sec, toLen(d), n, inp.slope, units);
    const cap = ratio >= 1 ? full.Q : manningQ(sec, ratio * toLen(d), n, inp.slope, units).Q;
    if (cap + 1e-12 < inp.Q) continue;
    const y = normalDepth(sec, inp.Q, n, inp.slope, units) ?? toLen(d);
    const flow = manningQ(sec, y, n, inp.slope, units);
    const [L, q, v] = us ? ["in", "cfs", "ft/s"] : ["mm", "m³/s", "m/s"];
    steps.push(`Full-flow capacity of Ø${d} ${L}: A = ${full.A.toFixed(4)}, R = ${full.R.toFixed(4)}, Q = (${us ? "1.486" : "1"}/${n}) × A × R^(2/3) × ${inp.slope}^(1/2) = ${full.Q.toFixed(3)} ${q}${ratio < 1 ? `; at y/D = ${ratio}: ${cap.toFixed(3)} ${q}` : ""}`);
    steps.push(`Design flow ${inp.Q} ${q}: normal depth y = ${(us ? y * 12 : y * 1000).toFixed(0)} ${L} (y/D = ${(y / toLen(d)).toFixed(2)}), velocity ${flow.V.toFixed(2)} ${v}; flowing full ${full.V.toFixed(2)} ${v}`);
    checks.push({ name: "Capacity", ok: true, detail: `${cap.toFixed(3)} ≥ ${inp.Q} ${q}` });
    checks.push({ name: `Self-cleansing velocity (${purpose})`, ok: full.V >= vMin, detail: `${full.V.toFixed(2)} ${v} flowing full vs ${vMin} ${v} minimum (${purpose === "storm" ? "HEC-22 guidance for storm drains" : "Ten States Standards for sewers"}); ${full.V < vMin ? "steepen the pipe if possible" : "OK"}` });
    return { diameter: d, unit: L, n, slope: inp.slope, purpose, fullCapacity: full.Q, fullVelocity: full.V, depth: us ? y * 12 : y * 1000, depthRatio: y / toLen(d), velocity: flow.V, steps, checks };
  }
  throw new Error(`No standard pipe up to ${STANDARD_PIPES[units].at(-1)} ${us ? "in" : "mm"} carries this flow at this slope; use a box culvert, a steeper slope or parallel pipes`);
}
