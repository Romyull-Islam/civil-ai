/**
 * Rectangular tied RC columns under axial load and uniaxial or biaxial bending, by strain compatibility.
 *
 * BNBC 2020 / ACI 318: equivalent rectangular stress block 0.85f'c over β1·c, εcu = 0.003, elastic-perfectly plastic
 * steel, φ from the net tensile strain (Table 21.2.2), φPn ≤ 0.80·φ·Po (22.4.2.1), biaxial by Bresler's reciprocal load
 * method (R22.4), slender non-sway columns by moment magnification (6.6.4).
 * IS 456: parabolic-rectangular block with 0.446fck, εcu = 0.0035 (or the 3D/7 pivot when the whole section is in
 * compression, cl. 39.1), SP-16 design curve for HYSD bars, biaxial by cl. 39.6, slender columns by cl. 39.7.
 *
 * Units: mm, MPa, N internally; inputs and outputs in kN and kN·m.
 */
import { type DesignCode, CODES, ES, beta1, phiTied, isSteelStress, isConcreteStress, concreteModulus } from "./rcCode";
import { areaOf, nameOf, columnBarSizes, barDia, type BarSystem } from "./rebar";

export interface Bar { x: number; y: number; area: number } // mm from the bottom-left corner
export interface RectSection { b: number; h: number; bars: Bar[] } // b along x, h along y
export type Axis = "x" | "y"; // bending about x: compression face at y = h (depth h); about y: at x = b (depth b)

export const barArea = (d: number) => (Math.PI * d * d) / 4;

/** Bars around the perimeter: 4 corners plus pairs on opposite faces, shared out by face length. */
export function perimeterBars(b: number, h: number, count: number, dia: number, clearCover = 40, tieDia = 10, sys: BarSystem = "metric"): Bar[] {
  const n = Math.max(4, count - (count % 2));
  const off = clearCover + tieDia + dia / 2;
  const w = b - 2 * off, t = h - 2 * off;
  const pairs = (n - 4) / 2;
  const onH = Math.round((pairs * t) / (w + t)); // extra bars on EACH of the two faces parallel to y (left/right)
  const onB = pairs - onH; // extra bars on EACH of the two faces parallel to x (top/bottom)
  const a = areaOf(dia, sys);
  const bars: Bar[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, k: number) => { for (let i = 1; i <= k; i++) bars.push({ x: x0 + ((x1 - x0) * i) / (k + 1), y: y0 + ((y1 - y0) * i) / (k + 1), area: a }); };
  for (const [x, y] of [[off, off], [b - off, off], [b - off, h - off], [off, h - off]]) bars.push({ x, y, area: a });
  line(off, off, off, h - off, onH); line(b - off, off, b - off, h - off, onH);
  line(off, off, b - off, off, onB); line(off, h - off, b - off, h - off, onB);
  return bars;
}

interface Response { P: number; M: number; et: number } // nominal (ACI) or design (IS) values, N and N·mm; εt tension +

/** Axial force and moment about the section centroid for neutral-axis depth c (from the compression face). */
export function sectionResponse(code: DesignCode, sec: RectSection, fc: number, fy: number, axis: Axis, c: number): Response {
  const depth = axis === "x" ? sec.h : sec.b;
  const width = axis === "x" ? sec.b : sec.h;
  const dz = (bar: Bar) => (axis === "x" ? sec.h - bar.y : sec.b - bar.x); // distance of the bar from the compression face
  const dt = Math.max(...sec.bars.map(dz));
  let P = 0, M = 0;
  if (CODES[code].family === "ACI") {
    const a = Math.min(beta1(fc) * c, depth);
    const Cc = 0.85 * fc * a * width;
    P += Cc; M += Cc * (depth / 2 - a / 2);
    for (const bar of sec.bars) {
      const z = dz(bar);
      const es = (0.003 * (c - z)) / c;
      let fs = Math.max(-fy, Math.min(fy, ES * es));
      if (z < a && fs > 0) fs -= 0.85 * fc; // concrete displaced by the bar
      P += bar.area * fs; M += bar.area * fs * (depth / 2 - z);
    }
    return { P, M, et: (0.003 * (dt - c)) / c };
  }
  // IS 456: strain profile (cl. 39.1) and numerical integration of the parabolic-rectangular block
  const strainAt = c <= depth ? (z: number) => (0.0035 * (c - z)) / c : (z: number) => (0.002 * (c - z)) / (c - (3 * depth) / 7);
  const top = Math.min(c, depth);
  const n = 400;
  for (let i = 0; i < n; i++) {
    const z = ((i + 0.5) * top) / n;
    const f = isConcreteStress(fc, strainAt(z)) * width * (top / n);
    P += f; M += f * (depth / 2 - z);
  }
  for (const bar of sec.bars) {
    const z = dz(bar);
    const e = strainAt(z);
    let fs = isSteelStress(fy, e);
    if (e > 0) fs -= isConcreteStress(fc, e);
    P += bar.area * fs; M += bar.area * fs * (depth / 2 - z);
  }
  return { P, M, et: -strainAt(dt) };
}

export interface DesignPoint { P: number; M: number; phi: number; c: number } // design values kN, kN·m

/** Design interaction curve (φPn, φMn for ACI; Pu, Mu for IS) from pure tension to the axial cap, for one axis. */
export function interactionCurve(code: DesignCode, sec: RectSection, fc: number, fy: number, axis: Axis, capAxial = true): DesignPoint[] {
  const depth = axis === "x" ? sec.h : sec.b;
  const As = sec.bars.reduce((s, b) => s + b.area, 0);
  const Ag = sec.b * sec.h;
  const aci = CODES[code].family === "ACI";
  const pts: DesignPoint[] = [];
  const Po = 0.85 * fc * (Ag - As) + fy * As;
  const cap = aci && capAxial ? 0.8 * 0.65 * Po : Number.POSITIVE_INFINITY; // ACI 22.4.2.1 tied
  pts.push({ P: (-(aci ? 0.9 : 0.87) * fy * As) / 1e3, M: 0, phi: aci ? 0.9 : 1, c: 0 });
  // neutral-axis depths from very shallow to far outside the section (pure compression)
  const cs: number[] = [];
  for (let i = 1; i <= 300; i++) cs.push(depth * (0.002 + (1.6 * i) / 300) ** 1.5);
  for (let i = 1; i <= 40; i++) cs.push(depth * (2 + i * 2));
  for (const c of cs) {
    const r = sectionResponse(code, sec, fc, fy, axis, c);
    const phi = aci ? phiTied(code, fy, r.et) : 1;
    pts.push({ P: Math.min(phi * r.P, cap) / 1e3, M: Math.max(0, (phi * r.M) / 1e6), phi, c });
  }
  if (aci) pts.push({ P: Math.min(cap, 0.65 * Po) / 1e3, M: 0, phi: 0.65, c: Number.POSITIVE_INFINITY });
  else { const r = sectionResponse(code, sec, fc, fy, axis, depth * 1e4); pts.push({ P: r.P / 1e3, M: 0, phi: 1, c: Number.POSITIVE_INFINITY }); }
  return pts;
}

/** Largest design moment the section carries at design axial load Pu (kN), from the interaction curve. */
export function momentCapacityAt(curve: DesignPoint[], Pu: number): number {
  let best = -1;
  for (let i = 0; i < curve.length - 1; i++) {
    const p = curve[i], q = curve[i + 1];
    if ((p.P - Pu) * (q.P - Pu) <= 0 && p.P !== q.P) best = Math.max(best, p.M + ((q.M - p.M) * (Pu - p.P)) / (q.P - p.P));
    else if (p.P === Pu) best = Math.max(best, p.M);
  }
  return best; // −1 when Pu is outside the curve (above the axial capacity or below pure tension)
}

/** Design axial load at which the resultant has eccentricity e = M/P (mm), i.e. where the ray M = P·e meets the curve. */
export function axialCapacityAtEccentricity(curve: DesignPoint[], e: number): number {
  let best = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const p = curve[i], q = curve[i + 1];
    const fp = p.M - (p.P * e) / 1000, fq = q.M - (q.P * e) / 1000; // P kN × e mm / 1000 = kN·m
    if (p.P > 0 && q.P > 0 && fp * fq <= 0 && fp !== fq) { const t = fp / (fp - fq); best = Math.max(best, p.P + t * (q.P - p.P)); }
  }
  return best;
}

export interface ColumnInput {
  code: DesignCode;
  b: number; // mm (x direction)
  h: number; // mm (y direction)
  fc: number; // f'c (ACI/BNBC) or fck (IS), MPa
  fy: number;
  Pu: number; // factored axial load, kN
  Mux?: number; // factored moment about x (acts over depth h), kN·m, larger end moment
  Muy?: number; // factored moment about y (acts over depth b), kN·m
  lu?: number; // unsupported length, mm (default 3000)
  k?: number; // effective length factor (default 1.0, braced)
  braced?: boolean; // non-sway frame (default true); sway frames need second-order moments from frame analysis
  endMomentRatio?: number; // |M1/M2| of the end moments, 0..1 (default 1 with single curvature: the worst case)
  curvature?: "single" | "double"; // default single (conservative)
  sustainedRatio?: number; // βdns = factored sustained axial / total factored axial (ACI 6.6.4.4.4), default 0.6
  clearCover?: number; // mm, default 40
  tieDia?: number; // mm, default 10
  bars?: { count: number; dia: number }; // check this arrangement; otherwise design one
  /** metric (default) or US bars #3–#11 (dia given as bar number or mm) */
  barSystem?: BarSystem;
}

export interface ColumnCheck { name: string; ok: boolean; detail: string }

/** Design moments including minimum eccentricity and slenderness effects, per code. */
/** Returns the design moment about one axis: `actual` (first-order moment, magnified if slender) and `withMin` (also at least
 * the code's minimum moment). Minimum moments apply about one axis at a time (ACI R6.6.4.5.4, IS 456 cl. 25.4). */
function designMoments(inp: ColumnInput, sec: RectSection, axis: Axis, M2: number, steps: string[], checks: ColumnCheck[]): { actual: number; withMin: number } {
  const depth = axis === "x" ? inp.h : inp.b;
  const lu = inp.lu ?? 3000;
  const k = inp.k ?? 1.0;
  const ratio = Math.min(1, Math.abs(inp.endMomentRatio ?? 1));
  const single = (inp.curvature ?? "single") === "single";
  const signed = single ? -ratio : ratio; // ACI 318-14/19 sign convention: M1/M2 negative in single curvature
  const Pu = inp.Pu;
  const tag = axis === "x" ? "x" : "y";
  if (CODES[inp.code].family === "ACI") {
    const r = 0.3 * depth; // 6.2.5.2 rectangular sections
    const slender = (k * lu) / r;
    const limit = inp.braced === false ? 22 : Math.min(40, 34 + 12 * signed);
    const Mmin = (Pu * (15 + 0.03 * depth)) / 1000; // 6.6.4.5.4, kN·m
    if (slender <= limit) { steps.push(`About ${tag}: k·lu/r = ${k}×${lu}/${r.toFixed(0)} = ${slender.toFixed(1)} ≤ ${limit.toFixed(1)} → slenderness may be neglected (ACI 6.2.5.1)`); return { actual: M2, withMin: M2 }; }
    if (inp.braced === false) {
      checks.push({ name: `Sway slenderness about ${tag}`, ok: false, detail: `k·lu/r = ${slender.toFixed(1)} > 22 in a sway frame: moments must come from a second-order frame analysis (ACI 6.6.4.6). Enter the magnified moments and set braced = true.` });
      return { actual: M2, withMin: M2 };
    }
    if (slender > 100) checks.push({ name: `k·lu/r ≤ 100 about ${tag}`, ok: false, detail: `${slender.toFixed(0)} > 100: nonlinear second-order analysis required (ACI 6.2.6)` });
    const Ig = axis === "x" ? (inp.b * inp.h ** 3) / 12 : (inp.h * inp.b ** 3) / 12;
    const Ec = concreteModulus(inp.code, inp.fc);
    const bdns = inp.sustainedRatio ?? 0.6;
    // ACI 6.6.4.4.4 (BNBC 6.3.10): EI = 0.4·Ec·Ig/(1+βdns) (a) or (0.2·Ec·Ig + Es·Ise)/(1+βdns) (b); both are permitted,
    // the smaller (more magnification) is used here
    const c0 = axis === "x" ? inp.h / 2 : inp.b / 2;
    const Ise = sec.bars.reduce((sum, bar) => sum + bar.area * ((axis === "x" ? bar.y : bar.x) - c0) ** 2, 0);
    const EI = Math.min(0.4 * Ec * Ig, 0.2 * Ec * Ig + ES * Ise) / (1 + bdns);
    const Pc = (Math.PI ** 2 * EI) / (k * lu) ** 2 / 1000; // kN
    const Cm = Math.max(0.4, 0.6 - 0.4 * signed); // 6.6.4.5.3(a); 0.4 floor kept for conservatism
    if (Pu >= 0.75 * Pc) { checks.push({ name: `Stability about ${tag}`, ok: false, detail: `Pu = ${Pu} kN ≥ 0.75·Pc = ${(0.75 * Pc).toFixed(0)} kN: column buckles; enlarge the section` }); return { actual: Number.POSITIVE_INFINITY, withMin: Number.POSITIVE_INFINITY }; }
    const dns = Math.max(1, Cm / (1 - Pu / (0.75 * Pc)));
    const Mc = dns * Math.max(M2, Mmin);
    steps.push(`About ${tag}: slender (k·lu/r = ${slender.toFixed(1)} > ${limit.toFixed(1)}). EI = min(0.4·Ec·Ig, 0.2·Ec·Ig + Es·Ise)/(1+βdns) = ${(EI / 1e12).toFixed(2)}×10¹² N·mm², Pc = ${Pc.toFixed(0)} kN, Cm = ${Cm.toFixed(2)}, δns = ${dns.toFixed(3)}, M2,min = ${Mmin.toFixed(1)} kN·m → Mc = ${Mc.toFixed(1)} kN·m (ACI 6.6.4.5)`);
    if (dns > 1.4) checks.push({ name: `Second-order moment ≤ 1.4 × first-order about ${tag}`, ok: false, detail: `δns = ${dns.toFixed(2)} > 1.4 (ACI 6.2.6): enlarge the section` });
    return { actual: dns * M2, withMin: Mc };
  }
  // IS 456
  const emin = Math.max(lu / 500 + depth / 30, 20); // cl. 25.4
  const Memin = (Pu * emin) / 1000;
  const lex = k * lu;
  if (lex / depth < 12) {
    steps.push(`About ${tag}: lex/D = ${(lex / depth).toFixed(1)} < 12 → short column (cl. 25.1.2); e,min = ${emin.toFixed(1)} mm → M,min = ${Memin.toFixed(1)} kN·m`);
    return { actual: M2, withMin: Math.max(M2, Memin) };
  }
  // cl. 39.7.1: additional moment, reduced by k = (Puz − Pu)/(Puz − Pb) ≤ 1 (39.7.1.1)
  const As = sec.bars.reduce((s, b) => s + b.area, 0);
  const Ag = inp.b * inp.h;
  const Puz = (0.45 * inp.fc * (Ag - As) + 0.75 * inp.fy * As) / 1000;
  const dEff = depth - (inp.clearCover ?? 40) - (inp.tieDia ?? 10) - 10;
  const xb = (0.0035 * dEff) / (0.0055 + (0.87 * inp.fy) / ES);
  const Pb = sectionResponse(inp.code, sec, inp.fc, inp.fy, axis, xb).P / 1000;
  const kr = Math.min(1, Math.max(0, (Puz - Pu) / (Puz - Pb)));
  const Ma = (kr * Pu * depth * (lex / depth) ** 2) / 2000 / 1000; // kN·m
  const M1 = ratio * M2 * (single ? 1 : -1); // IS: M1 negative when the column bends in double curvature
  const Minit = Math.max(0.4 * M1 + 0.6 * M2, 0.4 * M2); // cl. 39.7.1 note 1 (braced columns)
  const Mact = Math.max(M2, Minit + Ma);
  const Mtot = Math.max(Mact, Memin);
  steps.push(`About ${tag}: slender (lex/D = ${(lex / depth).toFixed(1)} ≥ 12). Puz = ${Puz.toFixed(0)} kN, Pb = ${Pb.toFixed(0)} kN, k = ${kr.toFixed(3)}, Ma = k·Pu·D/2000·(lex/D)² = ${Ma.toFixed(1)} kN·m, Mi = ${Minit.toFixed(1)} kN·m → M = ${Mtot.toFixed(1)} kN·m (IS 456 cl. 39.7.1)`);
  return { actual: Mact, withMin: Mtot };
}

export interface ColumnResult {
  code: DesignCode;
  bars: { count: number; dia: number; area: number; percent: number; label: string };
  ties: string;
  capacity: { axialMax: number; Mux: number; Muy: number; biaxialRatio: number | null };
  designMoments: { x: number; y: number };
  curve: { x: DesignPoint[]; y: DesignPoint[] };
  checks: ColumnCheck[];
  steps: string[];
  ok: boolean;
}

function checkArrangement(inp: ColumnInput, count: number, dia: number): ColumnResult {
  const code = inp.code;
  const aci = CODES[code].family === "ACI";
  const cover = inp.clearCover ?? 40;
  const sys = inp.barSystem ?? "metric", us = sys === "US";
  dia = barDia(dia, sys);
  // ACI 25.7.2.2: #3 ties for longitudinal bars up to #10, #4 for #11 and larger (metric: Ø10 up to Ø32, Ø12 above)
  const tie = inp.tieDia !== undefined ? barDia(inp.tieDia, sys) : us ? barDia(dia > 33 ? 4 : 3, sys) : dia > 32 ? 12 : 10;
  const bars = perimeterBars(inp.b, inp.h, count, dia, cover, tie, sys);
  const sec: RectSection = { b: inp.b, h: inp.h, bars };
  const As = bars.reduce((s, b) => s + b.area, 0);
  const Ag = inp.b * inp.h;
  const pct = (100 * As) / Ag;
  const steps: string[] = [];
  const checks: ColumnCheck[] = [];
  steps.push(`${CODES[code].label}: ${bars.length} × ${us ? nameOf(dia, sys) : `Ø${dia} mm`} = ${As.toFixed(0)} mm² (${pct.toFixed(2)}% of ${inp.b}×${inp.h} mm)`);
  // ACI 318-19 10.6.1.1: 1–8%; BNBC 2020 Sec 6.3.9.1: 1–6% (preferably ≤ 4%); IS 456 cl. 26.5.3.1: 0.8–4% practical (6% absolute)
  const minPct = aci ? 1.0 : 0.8, maxPct = code === "ACI318" ? 8.0 : code === "BNBC2020" ? 6.0 : 4.0;
  checks.push({ name: `Steel ${minPct}–${maxPct}%`, ok: pct >= minPct - 1e-9 && pct <= maxPct, detail: `${pct.toFixed(2)}%${pct > 4 && aci ? " (above 4% makes lap splices congested; BNBC prefers ≤ 4%: consider a larger section)" : ""}` });
  // clear spacing between adjacent bars along each face (ACI 25.2.3: ≥ max(40 mm, 1.5db); IS 26.5.3.1: ≤ 300 mm along the perimeter)
  const off = cover + tie + dia / 2;
  const byFace = [bars.filter((b) => Math.abs(b.y - off) < 1).map((b) => b.x), bars.filter((b) => Math.abs(b.x - off) < 1).map((b) => b.y)];
  const spacings = byFace.flatMap((xs) => { const s = [...xs].sort((a, b) => a - b); return s.slice(1).map((v, i) => v - s[i]); });
  const minClear = Math.min(...spacings) - dia, maxCtc = Math.max(...spacings);
  const needClear = Math.max(40, 1.5 * dia);
  checks.push({ name: "Bar spacing", ok: minClear >= needClear && (aci || maxCtc <= 300), detail: `clear ${minClear.toFixed(0)} mm (min ${needClear.toFixed(0)})${aci ? "" : `, centre-to-centre max ${maxCtc.toFixed(0)} mm (≤ 300)`}` });

  const mx = designMoments(inp, sec, "x", Math.abs(inp.Mux ?? 0), steps, checks);
  const my = designMoments(inp, sec, "y", Math.abs(inp.Muy ?? 0), steps, checks);
  const Mx = mx.actual, My = my.actual;
  const cx = interactionCurve(code, sec, inp.fc, inp.fy, "x");
  const cy = interactionCurve(code, sec, inp.fc, inp.fy, "y");
  const axialMax = Math.max(...cx.map((p) => p.P));
  const Pu = inp.Pu;
  checks.push({ name: aci ? "Pu ≤ φPn,max" : "Pu ≤ axial capacity", ok: Pu <= axialMax, detail: `${Pu} ≤ ${axialMax.toFixed(0)} kN${aci ? " (0.80·φ·Po, ACI 22.4.2.1)" : ""}` });
  const Mcx = momentCapacityAt(cx, Pu), Mcy = momentCapacityAt(cy, Pu);
  let biaxialRatio: number | null = null;
  const bothAxes = Mx > 1e-9 && My > 1e-9;
  // each axis on its own with its minimum moment (one axis at a time)
  for (const [ax, m, Mc] of [["x", mx.withMin, Mcx], ["y", my.withMin, Mcy]] as const) {
    if (m > 1e-9 || ax === "x") checks.push({ name: `M about ${ax} ≤ capacity`, ok: Mc >= 0 && m <= Mc + 1e-9, detail: `${m.toFixed(1)} ≤ ${Math.max(0, Mc).toFixed(1)} kN·m at Pu = ${Pu} kN${m > (ax === "x" ? Mx : My) + 1e-9 ? " (minimum moment governs)" : ""}` });
  }
  if (!bothAxes) {
    // uniaxial: covered by the per-axis checks above
  } else if (aci) {
    const Ag01 = (0.1 * inp.fc * Ag) / 1000;
    if (Pu >= Ag01) {
      // Bresler reciprocal load method (ACI R22.4): 1/φPn = 1/φPnx + 1/φPny − 1/φPo, on the curves WITHOUT the 0.80 cap,
      // then φPn ≤ φPn,max (the cap is applied to the result, not inside the reciprocal formula)
      const ux = interactionCurve(code, sec, inp.fc, inp.fy, "x", false), uy = interactionCurve(code, sec, inp.fc, inp.fy, "y", false);
      const Px = axialCapacityAtEccentricity(ux, (Mx / Pu) * 1000);
      const Py = axialCapacityAtEccentricity(uy, (My / Pu) * 1000);
      const Po = Math.max(...ux.map((p) => p.P));
      const Pn = Math.min(1 / (1 / Px + 1 / Py - 1 / Po), axialMax);
      biaxialRatio = Pu / Pn;
      steps.push(`Biaxial (Bresler): φPnx = ${Px.toFixed(0)} kN at ey = ${((Mx / Pu) * 1000).toFixed(0)} mm, φPny = ${Py.toFixed(0)} kN at ex = ${((My / Pu) * 1000).toFixed(0)} mm, φPo = ${Po.toFixed(0)} kN → φPn = ${Pn.toFixed(0)} kN`);
      checks.push({ name: "Biaxial: Pu ≤ φPn (Bresler)", ok: Pu <= Pn, detail: `${Pu} ≤ ${Pn.toFixed(0)} kN` });
    } else {
      biaxialRatio = Mx / Mcx + My / Mcy;
      steps.push(`Biaxial, low axial load (Pu < 0.1·f'c·Ag): Mux/φMnx + Muy/φMny = ${biaxialRatio.toFixed(3)}`);
      checks.push({ name: "Biaxial: Mux/φMnx + Muy/φMny ≤ 1", ok: biaxialRatio <= 1, detail: biaxialRatio.toFixed(3) });
    }
  } else {
    // IS 456 cl. 39.6: (Mux/Mux1)^αn + (Muy/Muy1)^αn ≤ 1, αn from Pu/Puz
    const Puz = (0.45 * inp.fc * (Ag - As) + 0.75 * inp.fy * As) / 1000;
    const r = Pu / Puz;
    const an = r <= 0.2 ? 1 : r >= 0.8 ? 2 : 1 + (r - 0.2) / 0.6;
    biaxialRatio = (Mx / Mcx) ** an + (My / Mcy) ** an;
    steps.push(`Biaxial (IS 456 cl. 39.6): Puz = ${Puz.toFixed(0)} kN, Pu/Puz = ${r.toFixed(2)}, αn = ${an.toFixed(2)}, Mux1 = ${Mcx.toFixed(1)}, Muy1 = ${Mcy.toFixed(1)} kN·m → ${biaxialRatio.toFixed(3)}`);
    checks.push({ name: "Biaxial interaction ≤ 1", ok: Mcx > 0 && Mcy > 0 && biaxialRatio <= 1, detail: biaxialRatio.toFixed(3) });
  }
  // ties: ACI 25.7.2 (Ø10 for bars ≤ Ø32, Ø12 above; s ≤ 16db, 48dtie, least dimension); IS 26.5.3.2 (≥ φ/4, ≥ 6 mm; s ≤ least dim, 16φ, 300)
  const tieDia = us ? tie : aci ? (dia > 32 ? 12 : 10) : [8, 10, 12, 16].find((t) => t >= dia / 4) ?? 16;
  const s = aci ? Math.min(16 * dia, 48 * tieDia, Math.min(inp.b, inp.h)) : Math.min(Math.min(inp.b, inp.h), 16 * dia, 300);
  const ties = `${nameOf(tieDia, sys)} ties @ ${Math.floor(s / 5) * 5} mm c/c`;
  steps.push(`Ties: ${ties} (${aci ? "ACI 25.7.2" : "IS 456 cl. 26.5.3.2"})`);
  return {
    code,
    bars: { count: bars.length, dia, area: As, percent: pct, label: us ? `${bars.length} ${nameOf(dia, sys)}` : `${bars.length} × Ø${dia} mm` },
    ties,
    capacity: { axialMax, Mux: Math.max(0, Mcx), Muy: Math.max(0, Mcy), biaxialRatio },
    designMoments: { x: mx.withMin, y: my.withMin },
    curve: { x: cx, y: cy },
    checks,
    steps,
    ok: checks.every((c) => c.ok),
  };
}

/** Check the given bars, or find the lightest perimeter arrangement that passes every check. */
export function designColumn(inp: ColumnInput): ColumnResult {
  if (!(inp.b > 0 && inp.h > 0 && inp.fc > 0 && inp.fy > 0)) throw new Error("b, h, fc and fy must be positive");
  if (!(inp.Pu >= 0)) throw new Error("Pu must be zero or positive (compression)");
  if (inp.bars) return checkArrangement(inp, inp.bars.count, inp.bars.dia);
  const options: { count: number; dia: number; area: number }[] = [];
  const sys = inp.barSystem ?? "metric";
  for (const dia of columnBarSizes(sys)) for (const count of [4, 6, 8, 10, 12, 14, 16, 18, 20, 24]) options.push({ count, dia, area: count * areaOf(dia, sys) });
  options.sort((a, b) => a.area - b.area || a.count - b.count);
  let last: ColumnResult | null = null;
  // Checks that no amount of steel can fix (slenderness limits, buckling, sway). If one fails, report the lightest
  // arrangement that satisfies everything else, so the only failure shown is the section size.
  const sectionLevel = /Second-order|Stability|Sway|k·lu\/r ≤ 100/;
  const sizeMsg = "The column section is too small for its length and load (see the failed check): enlarge the section, reduce the unsupported length, or give the actual end moments and curvature (double curvature is usual in braced frames).";
  for (const o of options) {
    const r = checkArrangement(inp, o.count, o.dia);
    last = r;
    if (r.ok) return r;
    const others = r.checks.filter((c) => !sectionLevel.test(c.name));
    if (r.checks.some((c) => !c.ok && sectionLevel.test(c.name)) && others.every((c) => c.ok)) return { ...r, steps: [...r.steps, sizeMsg] };
  }
  if (last && last.checks.some((c) => !c.ok && sectionLevel.test(c.name))) return { ...last, steps: [...last.steps, sizeMsg] };
  return { ...last!, steps: [...last!.steps, "No bar arrangement up to 24 bars passes: increase the column size or concrete grade."] };
}
