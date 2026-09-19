/**
 * Reinforced concrete members: beams (flexure + shear), one-way slabs and isolated square footings.
 * Codes: BNBC 2020 (Part 6 Ch. 6, following ACI 318M-11), ACI 318-19 and IS 456:2000. Columns are in column.ts.
 * Units: mm, MPa, kN, kN·m. Clause references are given next to each rule so the calculations can be reviewed.
 *
 * These are design calculators for a qualified engineer: results must be checked and signed by a licensed engineer.
 */
import {
  type DesignCode, CODES, DEFAULT_CODE, normalizeCode, ES, beta1, strainLimits, fytMax, slabMinSteelRatio, lambdaS,
  isSteelStress, tauC_IS, tauCmax_IS, slabShearK_IS, tauBd_IS, phiTied,
} from "./rcCode";
import { areaOf, nameOf, mainBarSizes, barDia, type BarSystem } from "./rebar";

export type { DesignCode } from "./rcCode";
export { tauC_IS } from "./rcCode";

export const BAR_SIZES_MM = [8, 10, 12, 16, 20, 22, 25, 28, 32] as const;
export const barArea = (d: number) => (Math.PI * d * d) / 4;

export interface Check { name: string; ok: boolean; detail: string }
export interface BarChoice { diameter: number; count: number; areaProvided: number; label: string }

/** Practical bar arrangements giving at least AsReq in width b (clear spacing ≥ max(db, 25 mm), ACI 25.2.1 / IS 26.3.2). */
export function chooseBars(AsReq: number, b: number, cover = 25, stirrup = 8, minBars = 2, preferred?: number[], sys: BarSystem = "metric"): BarChoice[] {
  const sizes = preferred ?? mainBarSizes(sys);
  const options: BarChoice[] = [];
  for (const d of sizes) {
    const a = areaOf(d, sys);
    const n = Math.max(minBars, Math.ceil(AsReq / a));
    const clear = (b - 2 * cover - 2 * stirrup - n * d) / Math.max(1, n - 1);
    if (n > 1 && clear < Math.max(d, 25)) continue;
    if (n > 8) continue;
    options.push({ diameter: d, count: n, areaProvided: n * a, label: sys === "US" ? `${n} ${nameOf(d, sys)} (${((n * a) / 645.16).toFixed(2)} in², ${(n * a).toFixed(0)} mm²)` : `${n} × Ø${d} mm (${(n * a).toFixed(0)} mm²)` });
  }
  const rank = (o: BarChoice) => (o.count >= 2 && o.count <= 4 ? 0 : o.count <= 6 ? 1 : 2);
  return options.sort((p, q) => rank(p) - rank(q) || p.areaProvided - q.areaProvided);
}

/** IS 456 cl. 38.1 note: xu,max/d. */
export function xuMaxRatio(fy: number): number {
  if (fy <= 250) return 0.53;
  if (fy <= 415) return 0.48;
  return 0.46;
}

/** √f'c used in shear/development, limited to 8.3 MPa (BNBC 6.4.1.2, ACI 22.5.3.1). */
const sqrtFc = (fc: number) => Math.min(Math.sqrt(fc), 8.3);

function checkMaterials(code: DesignCode, fc: number, fy: number) {
  if (!(fc > 0 && fy > 0)) throw new Error("Concrete and steel strengths must be positive");
  if (CODES[code].family === "ACI" && fy > 550) throw new Error("fy above 550 MPa is not permitted in design (BNBC 6.2.4, ACI Table 20.2.2.4a)");
  if (CODES[code].family === "ACI" && fc < 17) throw new Error("f'c below 17 MPa is not permitted for structural concrete (BNBC 6.1.6, ACI 19.2.1)");
}

/** IS 456 Fig. 4 modification factor for tension steel (fit of the chart used in SP-24): 1/(0.225 + 0.00322fs − 0.625·log10(1/pt)) ≤ 2. */
export function isTensionModFactor(fs: number, ptPercent: number): number {
  const pt = Math.max(0.1, ptPercent);
  return Math.min(2, Math.max(0.5, 1 / (0.225 + 0.00322 * fs - 0.625 * Math.log10(1 / pt))));
}

/** Minimum thickness (ACI Table 7.3.1.1 slabs / 9.3.1.1 beams; BNBC Table 6.6.1), with the fy correction 0.4 + fy/700. */
export function aciMinThickness(member: "slab" | "beam", support: SupportType, spanMm: number, fy: number): number {
  const div = member === "slab" ? { simply_supported: 20, one_end_continuous: 24, both_ends_continuous: 28, cantilever: 10 } : { simply_supported: 16, one_end_continuous: 18.5, both_ends_continuous: 21, cantilever: 8 };
  return (spanMm / div[support]) * (0.4 + fy / 700);
}
export type SupportType = "simply_supported" | "one_end_continuous" | "both_ends_continuous" | "cantilever";
export const normalizeSupport = (s: string | undefined): SupportType => (s === "continuous" ? "both_ends_continuous" : s === "one_end_continuous" || s === "both_ends_continuous" || s === "cantilever" ? s : "simply_supported");

// ============================== Beams ==============================

export interface RcBeamInput {
  code?: DesignCode | string;
  b: number; // mm
  D: number; // overall depth mm
  cover?: number; // clear cover to stirrups mm (default 25 IS / 40 ACI-BNBC)
  fck: number; // fck (IS) or f'c (ACI/BNBC), MPa
  fy: number; // longitudinal steel, MPa
  fyStirrup?: number; // stirrup steel, MPa (default = fy, capped by code)
  Mu: number; // factored moment kN·m
  Vu?: number; // factored shear kN
  stirrupDia?: number;
  mainBarDia?: number; // for effective depth (default 16; US: bar number, default #6)
  /** metric bars (default) or US bars #3–#11 (bar sizes may be given as bar numbers) */
  barSystem?: BarSystem;
  span?: number; // m, optional: minimum depth / deflection check
  support?: SupportType | "continuous";
}

export interface RcBeamResult {
  code: DesignCode;
  d: number;
  MuLim?: number;
  singlyReinforced: boolean;
  AstRequired: number;
  AstMin: number;
  AstMax: number;
  AscRequired: number;
  ptProvidedPercent: number;
  tensionBars: BarChoice[];
  compressionBars?: BarChoice[];
  shear?: { tauV: number; tauC: number; tauCmax: number; Vus: number; stirrupSpacing: number; stirrupLabel: string; ok: boolean };
  checks: Check[];
  steps: string[];
}

export function designRcBeam(inp: RcBeamInput): RcBeamResult {
  const code = normalizeCode(inp.code ?? DEFAULT_CODE);
  const aci = CODES[code].family === "ACI";
  checkMaterials(code, inp.fck, inp.fy);
  const cover = inp.cover ?? (aci ? 40 : 25);
  const sys = inp.barSystem ?? "metric";
  const sdIn = inp.stirrupDia ?? (sys === "US" ? 3 : aci ? 10 : 8);
  const sd = sdIn === 0 ? 0 : barDia(sdIn, sys); // 0 = no stirrups (slab and footing strips)
  const db = barDia(inp.mainBarDia ?? (sys === "US" ? 6 : 16), sys);
  const { b, D, fck: fc, fy } = inp;
  if (b <= 0 || D <= 0) throw new Error("b and D must be positive");
  const d = D - cover - sd - db / 2;
  const dPrime = cover + sd + db / 2;
  const Mu = inp.Mu * 1e6;
  const steps: string[] = [`${CODES[code].label}. Effective depth d = D − cover − stirrup − bar/2 = ${D} − ${cover} − ${sd} − ${db / 2} = ${d.toFixed(1)} mm`];
  const checks: Check[] = [];
  let AstRequired = 0, AscRequired = 0, MuLim: number | undefined, singly = true, AstMin: number, AstMax: number;

  if (!aci) {
    const k = xuMaxRatio(fy);
    const xuMax = k * d;
    MuLim = 0.36 * fc * b * xuMax * (d - 0.42 * xuMax); // cl. 38.1 / Annex G-1.1
    steps.push(`xu,max/d = ${k} (Fe${fy}); Mu,lim = 0.36·fck·b·xu,max·(d − 0.42·xu,max) = ${(MuLim / 1e6).toFixed(2)} kN·m (IS 456 G-1.1)`);
    AstMin = (0.85 * b * d) / fy; // cl. 26.5.1.1(a)
    AstMax = 0.04 * b * D; // cl. 26.5.1.1(b)
    if (Mu <= MuLim) {
      const A = (0.87 * fy * fy) / (fc * b), B = -0.87 * fy * d;
      AstRequired = (-B - Math.sqrt(B * B - 4 * A * Mu)) / (2 * A);
      steps.push(`Singly reinforced: Mu = 0.87·fy·Ast·d·(1 − fy·Ast/(fck·b·d)) → Ast = ${AstRequired.toFixed(0)} mm² (IS 456 G-1.1(b))`);
    } else {
      singly = false;
      const Ast1 = MuLim / (0.87 * fy * (d - 0.42 * xuMax));
      const esc = (0.0035 * (xuMax - dPrime)) / xuMax; // strain at the compression steel
      const fsc = isSteelStress(fy, esc); // SP-16 Table A / IS 456 Fig. 23
      const fcc = 0.446 * fc;
      AscRequired = (Mu - MuLim) / ((fsc - fcc) * (d - dPrime));
      const Ast2 = (AscRequired * (fsc - fcc)) / (0.87 * fy);
      AstRequired = Ast1 + Ast2;
      steps.push(`Mu > Mu,lim → doubly reinforced (IS 456 G-1.2). εsc = 0.0035·(xu,max − d')/xu,max = ${esc.toFixed(5)} → fsc = ${fsc.toFixed(0)} MPa (SP-16 Table A); Asc = (Mu − Mu,lim)/((fsc − 0.446fck)(d − d')) = ${AscRequired.toFixed(0)} mm²; Ast = ${Ast1.toFixed(0)} + ${Ast2.toFixed(0)} = ${AstRequired.toFixed(0)} mm²`);
    }
  } else {
    const phi = 0.9;
    const b1 = beta1(fc);
    const et = strainLimits(code, fy).tension;
    AstMin = Math.max((0.25 * Math.sqrt(fc)) / fy, 1.4 / fy) * b * d; // ACI 9.6.1.2, BNBC 6.3.5.1
    const cTc = (0.003 * d) / (0.003 + et); // deepest neutral axis that is still tension-controlled
    AstMax = (0.85 * fc * b * b1 * cTc) / fy;
    const A = (fy * fy) / (2 * 0.85 * fc * b), B = -fy * d, C = Mu / phi;
    const disc = B * B - 4 * A * C;
    const singlyAs = disc >= 0 ? (-B - Math.sqrt(disc)) / (2 * A) : Number.POSITIVE_INFINITY;
    if (singlyAs <= AstMax) {
      AstRequired = singlyAs;
      const a = (AstRequired * fy) / (0.85 * fc * b), c = a / b1, eps = (0.003 * (d - c)) / c;
      steps.push(`β1 = ${b1.toFixed(3)}. Mu/φ = As·fy·(d − a/2) with φ = 0.9 → As = ${AstRequired.toFixed(0)} mm², a = ${a.toFixed(1)} mm, c = ${c.toFixed(1)} mm, εt = ${eps.toFixed(4)} ≥ ${et.toFixed(4)} (tension-controlled)`);
    } else {
      // Doubly reinforced by strain compatibility at the tension-controlled limit c = cTc
      singly = false;
      const Cc = 0.85 * fc * b * b1 * cTc;
      const Mn1 = Cc * (d - (b1 * cTc) / 2);
      const Mn2 = Mu / phi - Mn1;
      const esc = (0.003 * (cTc - dPrime)) / cTc;
      const fsc = Math.min(fy, ES * esc);
      if (fsc - 0.85 * fc <= 0) throw new Error("Compression steel is ineffective at this depth: increase the beam depth");
      AscRequired = Mn2 / ((fsc - 0.85 * fc) * (d - dPrime));
      AstRequired = (Cc + AscRequired * (fsc - 0.85 * fc)) / fy;
      steps.push(`A tension-controlled singly reinforced section cannot carry Mu → compression steel at c = ${cTc.toFixed(1)} mm (εt = ${et.toFixed(4)}): εs' = ${esc.toFixed(4)}, fs' = ${fsc.toFixed(0)} MPa, As' = ${AscRequired.toFixed(0)} mm², As = ${AstRequired.toFixed(0)} mm²`);
      AstMax = Number.POSITIVE_INFINITY; // the limit is met by design (c = cTc)
    }
  }

  const AstDesign = Math.max(AstRequired, AstMin);
  checks.push({ name: "As ≥ As,min", ok: true, detail: `As,min = ${AstMin.toFixed(0)} mm²${AstRequired < AstMin ? " governs; minimum steel provided" : ""}` });
  if (Number.isFinite(AstMax)) checks.push({ name: aci ? "Tension-controlled (As ≤ As,tc)" : "Ast ≤ 4% bD", ok: AstDesign <= AstMax, detail: `limit ${AstMax.toFixed(0)} mm²` });

  const tensionBars = chooseBars(AstDesign, b, cover, sd, 2, undefined, sys);
  const compressionBars = AscRequired > 0 ? chooseBars(AscRequired, b, cover, sd, 2, undefined, sys) : undefined;
  if (!tensionBars.length) checks.push({ name: "Bars fit in one layer", ok: false, detail: "Steel does not fit in one layer: widen the beam or use two layers" });
  const provided = tensionBars[0]?.areaProvided ?? AstDesign;
  const pt = (100 * provided) / (b * d);

  if (inp.span) {
    const support = normalizeSupport(inp.support);
    const L = inp.span * 1000;
    if (aci) {
      const hMin = aciMinThickness("beam", support, L, fy);
      checks.push({ name: "Depth ≥ minimum (deflection)", ok: D >= hMin, detail: `h = ${D} ≥ ${hMin.toFixed(0)} mm (${code === "BNBC2020" ? "BNBC Table 6.6.1" : "ACI Table 9.3.1.1"}); otherwise compute deflections` });
    } else {
      const basic = support === "cantilever" ? 7 : support === "simply_supported" ? 20 : 26;
      const fs = (0.58 * fy * AstDesign) / provided;
      const mf = isTensionModFactor(fs, pt);
      const allowed = basic * mf * (L > 10000 && support !== "cantilever" ? 10000 / L : 1);
      checks.push({ name: "Span/d (IS 456 cl. 23.2.1)", ok: L / d <= allowed, detail: `L/d = ${(L / d).toFixed(1)} ≤ ${basic} × ${mf.toFixed(2)} = ${allowed.toFixed(1)}` });
    }
  }

  let shear: RcBeamResult["shear"];
  if (inp.Vu !== undefined) {
    const Vu = inp.Vu * 1e3;
    const legs = 2;
    const Asv = legs * areaOf(sd, sys);
    const fyt = Math.min(inp.fyStirrup ?? fy, fytMax(code)); // IS 456 cl. 40.4 / ACI 20.2.2.4 / BNBC 6.4.3.2
    const tauV = Vu / (b * d);
    if (!aci) {
      const tauC = tauC_IS(fc, pt);
      const tauCmax = tauCmax_IS(fc);
      const Vus = Math.max(0, Vu - tauC * b * d);
      let sv = Vus > 0 ? (0.87 * fyt * Asv * d) / Vus : Number.POSITIVE_INFINITY; // cl. 40.4(a)
      const svMin = (0.87 * fyt * Asv) / (0.4 * b); // cl. 26.5.1.6
      sv = Math.floor(Math.min(sv, svMin, 0.75 * d, 300) / 10) * 10; // cl. 26.5.1.5
      shear = { tauV, tauC, tauCmax, Vus: Vus / 1e3, stirrupSpacing: sv, stirrupLabel: `${legs}-legged ${nameOf(sd, sys)} @ ${sv} mm c/c`, ok: tauV <= tauCmax };
      steps.push(`Shear (IS 456 cl. 40): τv = ${tauV.toFixed(3)} MPa, τc = ${tauC.toFixed(3)} MPa (Table 19, pt = ${pt.toFixed(2)}%), τc,max = ${tauCmax} MPa; Vus = ${(Vus / 1e3).toFixed(1)} kN with fy,stirrup = ${fyt} MPa → ${shear.stirrupLabel}`);
      checks.push({ name: "τv ≤ τc,max", ok: tauV <= tauCmax, detail: `${tauV.toFixed(3)} ≤ ${tauCmax} MPa (IS 456 Table 20)` });
    } else {
      const phiV = 0.75;
      const rt = sqrtFc(fc);
      // Beams are always given at least Av,min here, so Vc = 0.17λ√f'c·bw·d (BNBC Eq. 6.6.49; ACI 318-19 Table 22.5.5.1(a))
      const Vc = 0.17 * rt * b * d;
      const Vs = Math.max(0, Vu / phiV - Vc);
      const VsMax = 0.66 * rt * b * d;
      let s = Vs > 0 ? (Asv * fyt * d) / Vs : Number.POSITIVE_INFINITY;
      const sMax = Vs <= 0.33 * rt * b * d ? Math.min(d / 2, 600) : Math.min(d / 4, 300);
      const sAvMin = (Asv * fyt) / Math.max(0.062 * Math.sqrt(fc) * b, 0.35 * b);
      s = Math.floor(Math.min(s, sMax, sAvMin) / 10) * 10;
      shear = { tauV, tauC: Vc / (b * d), tauCmax: (Vc + VsMax) / (b * d), Vus: Vs / 1e3, stirrupSpacing: s, stirrupLabel: `${legs}-leg ${nameOf(sd, sys)} @ ${s} mm`, ok: Vs <= VsMax };
      steps.push(`Shear: Vc = 0.17√f'c·b·d = ${(Vc / 1e3).toFixed(1)} kN; Vs = Vu/0.75 − Vc = ${(Vs / 1e3).toFixed(1)} kN; fyt = ${fyt} MPa → ${shear.stirrupLabel} (s ≤ ${sMax.toFixed(0)} mm, Av,min spacing ${sAvMin.toFixed(0)} mm)`);
      checks.push({ name: "Vs ≤ 0.66√f'c·b·d", ok: Vs <= VsMax, detail: `${(Vs / 1e3).toFixed(1)} ≤ ${(VsMax / 1e3).toFixed(1)} kN (section too small otherwise)` });
    }
  }

  return { code, d, MuLim: MuLim !== undefined ? MuLim / 1e6 : undefined, singlyReinforced: singly, AstRequired: AstDesign, AstMin, AstMax, AscRequired, ptProvidedPercent: pt, tensionBars, compressionBars, shear, checks, steps };
}

// ============================== One-way slabs ==============================

export interface SlabInput {
  code?: DesignCode | string;
  span: number; // m, effective span
  liveLoad: number; // kN/m²
  floorFinish?: number; // kN/m² (default 1.0)
  partitionLoad?: number; // kN/m² extra dead load (default 0)
  fck: number;
  fy: number;
  cover?: number; // clear cover mm (default 20)
  support?: SupportType | "continuous";
  thickness?: number; // mm, optional
  barDia?: number; // main bar mm (default 10; US: bar number, default #4)
  barSystem?: BarSystem;
  brickAggregate?: boolean; // BNBC 8.1.11.2: 1.5× minimum steel for brick-aggregate concrete
}

export interface SlabResult {
  code: DesignCode;
  thickness: number;
  d: number;
  selfWeight: number;
  totalLoad: number;
  factoredLoad: number;
  Mu: number; // governing (largest) moment kN·m/m
  MuSpan: number;
  MuSupport: number;
  Vu: number;
  AstRequired: number;
  AstMin: number;
  mainBars: string;
  topBars: string | null;
  distributionBars: string;
  deflectionCheck: Check;
  shearCheck: Check;
  checks: Check[];
  steps: string[];
}

export function designOneWaySlab(inp: SlabInput): SlabResult {
  const code = normalizeCode(inp.code ?? DEFAULT_CODE);
  const aci = CODES[code].family === "ACI";
  checkMaterials(code, inp.fck, inp.fy);
  const support = normalizeSupport(inp.support);
  const cover = inp.cover ?? 20;
  const sys = inp.barSystem ?? "metric";
  const barD = barDia(inp.barDia ?? (sys === "US" ? 4 : 10), sys);
  const L = inp.span * 1000;
  const fc = inp.fck, fy = inp.fy;
  const steps: string[] = [`${CODES[code].label}; ${support.replace(/_/g, " ")} one-way slab, span ${inp.span} m`];
  const unitWt = aci ? 23.6 : 25; // BNBC Table 6.2.1 reinforced concrete 23.6 kN/m³; IS 875-1: 25 kN/m³
  const ff = inp.floorFinish ?? 1.0;
  const extra = inp.partitionLoad ?? 0;
  const minRatio = slabMinSteelRatio(code, fy) * (inp.brickAggregate && code === "BNBC2020" ? 1.5 : 1);

  // moment and shear per metre width for a factored load, by code coefficients
  const actions = (h: number) => {
    const sw = (h / 1000) * unitWt;
    const wd = sw + ff + extra, wl = inp.liveLoad;
    if (!aci) {
      const f = 1.5; // IS 456 Table 18
      const [ds, ls, dsu, lsu, dv, lv] = {
        simply_supported: [1 / 8, 1 / 8, 0, 0, 0.5, 0.5],
        cantilever: [0, 0, 1 / 2, 1 / 2, 1, 1],
        one_end_continuous: [1 / 12, 1 / 10, 1 / 10, 1 / 9, 0.6, 0.6], // IS Table 12 & 13: end span, support next to end support
        both_ends_continuous: [1 / 16, 1 / 12, 1 / 12, 1 / 9, 0.5, 0.6], // interior span, interior support
      }[support];
      return { sw, wd, wl, wu: f * (wd + wl), Mspan: f * (ds * wd + ls * wl) * inp.span ** 2, Msup: f * (dsu * wd + lsu * wl) * inp.span ** 2, V: f * (dv * wd + lv * wl) * inp.span };
    }
    const wu = Math.max(1.4 * wd, 1.2 * wd + 1.6 * wl); // BNBC 2.7.3.1 / ACI 5.3.1
    const [cs, csu, cv] = { simply_supported: [1 / 8, 0, 0.5], cantilever: [0, 1 / 2, 1], one_end_continuous: [1 / 11, 1 / 10, 1.15 / 2], both_ends_continuous: [1 / 16, 1 / 11, 0.5] }[support]; // ACI 6.5 approximate coefficients
    return { sw, wd, wl, wu, Mspan: cs * wu * inp.span ** 2, Msup: csu * wu * inp.span ** 2, V: cv * wu * inp.span };
  };

  // thickness: ACI/BNBC minimum-thickness table, IS span/effective-depth with the steel modification factor
  let h = inp.thickness ?? (aci ? Math.max(100, Math.ceil(aciMinThickness("slab", support, L, fy) / 10) * 10) : 100);
  let a = actions(h), d = h - cover - barD / 2;
  const steelFor = (M: number, dd: number, hh: number) => {
    if (M <= 0) return 0;
    const req = designRcBeam({ code, b: 1000, D: hh, cover, fck: fc, fy, Mu: M, stirrupDia: 0, mainBarDia: barD }).AstRequired;
    return Math.max(req, minRatio * 1000 * hh);
  };
  const spacing = (As: number, dia: number, max: number) => Math.min(Math.floor((1000 * ((d: number) => areaOf(d, sys))(dia)) / As / 10) * 10, max);
  let isMF = 1, isAllowed = 0;
  for (let guard = 0; guard < 80; guard++) {
    a = actions(h); d = h - cover - barD / 2;
    if (aci || inp.thickness) break;
    const M = support === "cantilever" ? a.Msup : a.Mspan; // steel that controls deflection
    const As = steelFor(M, d, h);
    const s = spacing(As, barD, Math.min(3 * d, 300));
    const prov = (1000 * ((d: number) => areaOf(d, sys))(barD)) / s;
    const basic = support === "cantilever" ? 7 : support === "simply_supported" ? 20 : 26; // cl. 23.2.1
    isMF = isTensionModFactor((0.58 * fy * As) / prov, (100 * prov) / (1000 * d));
    isAllowed = basic * isMF * (L > 10000 && support !== "cantilever" ? 10000 / L : 1);
    if (L / d <= isAllowed) break;
    h += 10;
  }
  const Ms = a.Mspan, Msu = a.Msup;
  steps.push(`Thickness h = ${h} mm, d = ${d.toFixed(0)} mm. Loads: self ${a.sw.toFixed(2)} + finish ${ff}${extra ? ` + partitions ${extra}` : ""} + live ${inp.liveLoad} kN/m² → wu = ${a.wu.toFixed(2)} kN/m (${aci ? "max(1.4D, 1.2D + 1.6L)" : "1.5(D + L)"})`);
  steps.push(`Moments per metre: span ${Ms.toFixed(2)}, support ${Msu.toFixed(2)} kN·m; shear ${a.V.toFixed(2)} kN (${aci ? "ACI 6.5 / BNBC approximate coefficients" : "IS 456 Tables 12–13"})`);

  const maxMain = aci ? Math.min(3 * h, 450) : Math.min(3 * d, 300); // ACI 7.7.2.3 / IS 26.3.3(b)(1)
  const maxDist = aci ? Math.min(5 * h, 450) : Math.min(5 * d, 450); // ACI 24.4.3.3 / IS 26.3.3(b)(2)
  const AsSpan = Ms > 0 ? steelFor(Ms, d, h) : 0;
  const AsSup = Msu > 0 ? steelFor(Msu, d, h) : 0;
  const AstMin = minRatio * 1000 * h;
  const bottomAs = Math.max(AsSpan, support === "cantilever" ? AstMin : 0);
  const sBot = spacing(Math.max(bottomAs, AstMin), barD, maxMain);
  const sTop = AsSup > 0 ? spacing(AsSup, barD, maxMain) : 0;
  const distDia = sys === "US" ? barDia(3, sys) : 8;
  const sDist = spacing(AstMin, distDia, maxDist);
  steps.push(`Minimum steel ${(minRatio * 100).toFixed(3)}% of bh = ${AstMin.toFixed(0)} mm²/m${inp.brickAggregate && code === "BNBC2020" ? " (×1.5 for brick aggregate, BNBC 8.1.11.2)" : ""}`);
  steps.push(`Bottom: As = ${Math.max(bottomAs, AstMin).toFixed(0)} mm²/m → ${nameOf(barD, sys)} @ ${sBot} mm${AsSup > 0 ? `; top over supports: As = ${AsSup.toFixed(0)} mm²/m → ${nameOf(barD, sys)} @ ${sTop} mm` : ""}; distribution ${nameOf(distDia, sys)} @ ${sDist} mm`);

  // deflection
  let deflectionCheck: Check;
  if (aci) {
    const hMin = aciMinThickness("slab", support, L, fy);
    deflectionCheck = { name: "Thickness ≥ minimum (deflection)", ok: h >= hMin - 0.5, detail: `h = ${h} ≥ ${hMin.toFixed(0)} mm (${code === "BNBC2020" ? "BNBC Table 6.6.1" : "ACI Table 7.3.1.1"})` };
  } else {
    const basic = support === "cantilever" ? 7 : support === "simply_supported" ? 20 : 26;
    const provBot = (1000 * ((d: number) => areaOf(d, sys))(barD)) / sBot;
    const AsDefl = support === "cantilever" ? Math.max(AsSup, AstMin) : Math.max(AsSpan, AstMin);
    const provDefl = support === "cantilever" && sTop ? (1000 * ((d: number) => areaOf(d, sys))(barD)) / sTop : provBot;
    isMF = isTensionModFactor((0.58 * fy * AsDefl) / Math.max(provDefl, 1), (100 * provDefl) / (1000 * d));
    isAllowed = basic * isMF * (L > 10000 && support !== "cantilever" ? 10000 / L : 1);
    deflectionCheck = { name: "Span/d (IS 456 cl. 23.2.1)", ok: L / d <= isAllowed + 1e-9, detail: `L/d = ${(L / d).toFixed(1)} ≤ ${basic} × MF ${isMF.toFixed(2)} = ${isAllowed.toFixed(1)}` };
  }

  // one-way shear (no shear reinforcement in slabs)
  const Vu = a.V * 1e3;
  const rho = Math.max(AsSpan, AsSup, AstMin) / (1000 * d);
  let shearCheck: Check;
  if (!aci) {
    const tc = slabShearK_IS(h) * tauC_IS(fc, 100 * rho);
    const tv = Vu / (1000 * d);
    shearCheck = { name: "Shear τv ≤ k·τc", ok: tv <= tc, detail: `${tv.toFixed(3)} ≤ ${tc.toFixed(3)} MPa (IS 456 cl. 40.2.1.1)` };
  } else {
    const Vc = CODES[code].sizeEffectShear
      ? Math.min(0.66 * lambdaS(d) * Math.cbrt(rho) * sqrtFc(fc), 0.42 * sqrtFc(fc)) * 1000 * d // ACI 318-19 Table 22.5.5.1(c)
      : 0.17 * sqrtFc(fc) * 1000 * d; // BNBC Eq. 6.6.49
    shearCheck = { name: "Shear Vu ≤ φVc", ok: Vu <= 0.75 * Vc, detail: `${(Vu / 1e3).toFixed(1)} ≤ ${((0.75 * Vc) / 1e3).toFixed(1)} kN/m${CODES[code].sizeEffectShear ? ` (λs = ${lambdaS(d).toFixed(3)}, ρw = ${(rho * 100).toFixed(2)}%)` : ""}` };
  }
  const checks = [deflectionCheck, shearCheck];
  return {
    code, thickness: h, d, selfWeight: a.sw, totalLoad: a.wd + a.wl, factoredLoad: a.wu,
    Mu: Math.max(Ms, Msu), MuSpan: Ms, MuSupport: Msu, Vu: a.V,
    AstRequired: Math.max(AsSpan, AsSup, AstMin), AstMin,
    mainBars: `${nameOf(barD, sys)} @ ${sBot} mm c/c bottom (${((1000 * ((d: number) => areaOf(d, sys))(barD)) / sBot).toFixed(0)} mm²/m)`,
    topBars: AsSup > 0 ? `${nameOf(barD, sys)} @ ${sTop} mm c/c top over supports (${((1000 * ((d: number) => areaOf(d, sys))(barD)) / sTop).toFixed(0)} mm²/m)` : null,
    distributionBars: `${nameOf(distDia, sys)} @ ${sDist} mm c/c`,
    deflectionCheck, shearCheck, checks, steps,
  };
}

// ============================== Isolated footings ==============================

export interface FootingInput {
  code?: DesignCode | string;
  columnB: number; // mm
  columnD: number; // mm
  serviceLoad?: number; // kN total unfactored (use deadLoad + liveLoad when known)
  deadLoad?: number; // kN
  liveLoad?: number; // kN
  safeBearingCapacity: number; // allowable net bearing pressure at founding level, kN/m²
  fck: number;
  fy: number;
  cover?: number; // clear cover mm (default 75 ACI/BNBC cast against earth, 50 IS)
  barDia?: number; // default 16 (US: bar number, default #5)
  barSystem?: BarSystem;
  selfWeightPercent?: number; // footing + backfill as % of the column load (default 10)
  brickAggregate?: boolean;
  loadFactor?: number; // overrides the factored/service ratio
}

export interface FootingResult {
  code: DesignCode;
  areaRequired: number;
  side: number;
  netUpwardPressure: number;
  depth: number;
  d: number;
  Mu: number;
  AstRequired: number;
  bars: string;
  oneWayShear: Check;
  punchingShear: Check;
  checks: Check[];
  steps: string[];
}

export function designIsolatedFooting(inp: FootingInput): FootingResult {
  const code = normalizeCode(inp.code ?? DEFAULT_CODE);
  const aci = CODES[code].family === "ACI";
  checkMaterials(code, inp.fck, inp.fy);
  const fc = inp.fck, fy = inp.fy;
  const cover = inp.cover ?? (aci ? 75 : 50); // ACI 20.5.1.3.1 cast against earth; IS 456 cl. 26.4.2.2
  const sys = inp.barSystem ?? "metric";
  const db = barDia(inp.barDia ?? (sys === "US" ? 5 : 16), sys);
  const steps: string[] = [CODES[code].label];
  const P = inp.deadLoad !== undefined || inp.liveLoad !== undefined ? (inp.deadLoad ?? 0) + (inp.liveLoad ?? 0) : inp.serviceLoad ?? 0;
  if (!(P > 0)) throw new Error("Give the column service load (or dead and live loads)");
  const Pu = inp.loadFactor ? inp.loadFactor * P
    : inp.deadLoad !== undefined || inp.liveLoad !== undefined
      ? aci ? Math.max(1.4 * (inp.deadLoad ?? 0), 1.2 * (inp.deadLoad ?? 0) + 1.6 * (inp.liveLoad ?? 0)) : 1.5 * P
      : 1.5 * P; // unknown split: 1.5 (IS exact; conservative for 1.2D + 1.6L unless live load exceeds ~75%)
  const sw = (inp.selfWeightPercent ?? 10) / 100;
  const areaReq = (P * (1 + sw)) / inp.safeBearingCapacity;
  const side = Math.ceil(Math.sqrt(areaReq) * 20) / 20;
  const B = side * 1000;
  steps.push(`Plan: A = P·(1 + ${sw})/q_allow = ${P}×${(1 + sw).toFixed(2)}/${inp.safeBearingCapacity} = ${areaReq.toFixed(2)} m² → ${side} × ${side} m`);
  const pu = Pu / (side * side);
  steps.push(`Factored load Pu = ${Pu.toFixed(0)} kN${inp.deadLoad === undefined && !inp.loadFactor ? " (1.5 × service; give dead and live loads separately for the exact combination)" : ""}; net upward pressure pu = ${pu.toFixed(1)} kN/m²`);
  const c1 = inp.columnB, c2 = inp.columnD;
  const lx = (B - Math.min(c1, c2)) / 2; // governing cantilever from the column face (square footing, smaller column side)
  const Mu = (pu * (lx / 1000) ** 2 * side) / 2; // kN·m over the full width
  steps.push(`Moment at the column face: Mu = pu·B·l²/2 = ${Mu.toFixed(1)} kN·m (l = ${lx.toFixed(0)} mm)`);
  const minRatio = slabMinSteelRatio(code, fy) * (inp.brickAggregate && code === "BNBC2020" ? 1.5 : 1);
  const rt = sqrtFc(fc);
  let D = Math.max(aci ? 150 + cover + db : 300, 250); // BNBC 6.8.7: ≥ 150 mm above bottom steel; IS 34.1.2 edge ≥ 150
  D = Math.ceil(D / 25) * 25;
  let d = 0, As = 0, oneWay: Check = { name: "", ok: false, detail: "" }, punching: Check = { name: "", ok: false, detail: "" };
  for (; D <= 2500; D += 25) {
    d = D - cover - db; // average of the two layers
    // Footings are singly reinforced: a depth whose flexure would need compression steel is too shallow, so go deeper.
    let flex: RcBeamResult;
    try { flex = designRcBeam({ code, b: B, D, cover: cover + db / 2, fck: fc, fy, Mu, stirrupDia: 0, mainBarDia: db }); } catch { continue; }
    if (flex.AscRequired > 0) continue;
    const req = flex.AstRequired;
    As = Math.max(req, minRatio * B * D);
    const rho = As / (B * d);
    const Vu1 = (pu * side * Math.max(0, lx - d)) / 1000; // kN, at d from the face
    const Vu2 = pu * (side * side - ((c1 + d) * (c2 + d)) / 1e6); // kN, at d/2 from the face
    const bo = 2 * (c1 + d + c2 + d);
    if (!aci) {
      const tc = tauC_IS(fc, 100 * rho);
      oneWay = { name: "One-way shear", ok: (Vu1 * 1e3) / (B * d) <= tc, detail: `τv = ${((Vu1 * 1e3) / (B * d)).toFixed(3)} ≤ τc = ${tc.toFixed(3)} MPa at pt = ${(100 * rho).toFixed(2)}% (IS 456 cl. 34.2.4.1(a), 40.2)` };
      const ks = Math.min(1, 0.5 + Math.min(c1, c2) / Math.max(c1, c2));
      const tp = ks * 0.25 * Math.sqrt(fc);
      punching = { name: "Punching shear", ok: (Vu2 * 1e3) / (bo * d) <= tp, detail: `τv = ${((Vu2 * 1e3) / (bo * d)).toFixed(3)} ≤ ks·0.25√fck = ${tp.toFixed(3)} MPa, bo = ${bo.toFixed(0)} mm (IS 456 cl. 31.6.3)` };
    } else {
      const Vc1 = CODES[code].sizeEffectShear ? Math.min(0.66 * lambdaS(d) * Math.cbrt(rho) * rt, 0.42 * rt) * B * d : 0.17 * rt * B * d;
      oneWay = { name: "One-way shear", ok: Vu1 * 1e3 <= 0.75 * Vc1, detail: `Vu = ${Vu1.toFixed(0)} ≤ φVc = ${((0.75 * Vc1) / 1e3).toFixed(0)} kN${CODES[code].sizeEffectShear ? ` (ACI 318-19 22.5.5.1(c), λs = ${lambdaS(d).toFixed(3)})` : " (BNBC 6.4.10.1.1, Vc = 0.17√f'c·b·d)"}` };
      const beta = Math.max(c1, c2) / Math.min(c1, c2);
      const vc = Math.min(0.33, 0.17 * (1 + 2 / beta), 0.083 * (2 + (40 * d) / bo)) * rt * (CODES[code].sizeEffectShear ? lambdaS(d) : 1);
      punching = { name: "Punching shear", ok: Vu2 * 1e3 <= 0.75 * vc * bo * d, detail: `Vu = ${Vu2.toFixed(0)} ≤ φVc = ${((0.75 * vc * bo * d) / 1e3).toFixed(0)} kN, vc = ${vc.toFixed(3)} MPa, bo = ${bo.toFixed(0)} mm (${CODES[code].sizeEffectShear ? "ACI 318-19 Table 22.6.5.2 with λs" : "BNBC 6.4.10.2.1"})` };
    }
    if (oneWay.ok && punching.ok) break;
  }
  const maxS = aci ? Math.min(3 * D, 450) : 300;
  const s = Math.max(75, Math.min(Math.floor((B * areaOf(db, sys)) / As / 5) * 5, maxS));
  steps.push(`Depth from shear: D = ${D} mm, d = ${d} mm. As = ${As.toFixed(0)} mm² each way (min ${(minRatio * 100).toFixed(3)}% of B·D) → ${nameOf(db, sys)} @ ${s} mm both ways`);
  const checks: Check[] = [oneWay, punching];
  // development length from the column face (IS 26.2.1; BNBC 8.2.2 / ACI 25.4.2.3 simplified, clear spacing ≥ 2db)
  const avail = lx - cover;
  const ld = !aci ? (db * 0.87 * fy) / (4 * tauBd_IS(fc)) : Math.max(300, ((fy * (code === "ACI318" ? (fy <= 420 ? 1 : 1.15) : 1)) / ((db <= 19 ? 2.1 : 1.7) * rt)) * db);
  checks.push({ name: "Development length", ok: avail >= ld, detail: `available ${avail.toFixed(0)} mm ≥ ld = ${ld.toFixed(0)} mm${avail < ld ? ": use smaller bars or hooks" : ""}` });
  // bearing of the column on the footing (ACI 22.8.3.2 / IS 456 cl. 34.4)
  const A1 = c1 * c2, A2 = B * B;
  const bearing = !aci ? 0.45 * fc * Math.min(2, Math.sqrt(A2 / A1)) * A1 : 0.65 * 0.85 * fc * Math.min(2, Math.sqrt(A2 / A1)) * A1;
  checks.push({ name: "Column bearing on footing", ok: Pu * 1e3 <= bearing, detail: `Pu = ${Pu.toFixed(0)} ≤ ${(bearing / 1e3).toFixed(0)} kN${Pu * 1e3 > bearing ? ": provide dowels for the excess" : ""}` });
  return { code, areaRequired: areaReq, side, netUpwardPressure: pu, depth: D, d, Mu, AstRequired: As, bars: `${nameOf(db, sys)} @ ${s} mm c/c both ways (bottom)`, oneWayShear: oneWay, punchingShear: punching, checks, steps };
}

// ============================== Flexural capacity of a given beam section ==============================

export interface BeamCapacityInput {
  code?: DesignCode | string;
  b: number; // mm
  d?: number; // effective depth mm (or give D, cover, stirrup and bar size)
  D?: number; // overall depth mm
  cover?: number; // clear cover to stirrups, mm
  stirrupDia?: number;
  As?: number; // tension steel mm² (or give bars)
  bars?: { count: number; dia: number }; // dia in mm, or US bar number with barSystem "US"
  fck: number; // f'c (ACI/BNBC) or fck (IS), MPa
  fy: number; // MPa
  Mu?: number; // factored moment demand kN·m (optional check)
  barSystem?: BarSystem;
}

/**
 * Design flexural strength of a singly reinforced rectangular section with the given steel.
 * ACI 318 / BNBC 2020: Whitney block a = As·fs/(0.85f'c·b), c = a/β1, εt = 0.003(d − c)/c; if the steel does not yield
 * (εt < εy) c follows from strain compatibility; φ from εt (Table 21.2.2); As,min = max(0.25√f'c, 1.4)·b·d/fy (9.6.1.2);
 * εt ≥ 0.004 for beams (9.3.3.1). IS 456: xu = 0.87fy·Ast/(0.36fck·b) ≤ xu,max, Mu = 0.87fy·Ast(d − 0.42xu) (Annex G-1.1),
 * limited to Mu,lim when over-reinforced; Ast,min = 0.85·b·d/fy (26.5.1.1).
 */
export function beamCapacity(inp: BeamCapacityInput) {
  const code = normalizeCode(inp.code ?? DEFAULT_CODE);
  const aci = CODES[code].family === "ACI";
  const sys = inp.barSystem ?? "metric";
  const { b, fck: fc, fy } = inp;
  if (!(b > 0 && fc > 0 && fy > 0)) throw new Error("b, concrete strength and fy must be positive");
  const steps: string[] = [];
  const checks: Check[] = [];
  let As = inp.As;
  let barNote = "";
  if (inp.bars) {
    const db = barDia(inp.bars.dia, sys);
    As = inp.bars.count * areaOf(db, sys);
    barNote = `${inp.bars.count} ${sys === "US" ? nameOf(db, sys) : `× Ø${db} mm`}`;
    steps.push(`As = ${barNote} = ${As.toFixed(0)} mm²${sys === "US" ? ` (${(As / 645.16).toFixed(2)} in²)` : ""}`);
  }
  if (!(As && As > 0)) throw new Error("Give the tension steel area As or the bars (count and size)");
  let d = inp.d;
  if (!d) {
    if (!inp.D) throw new Error("Give the effective depth d, or the overall depth D");
    const cover = inp.cover ?? (aci ? 40 : 25);
    const sd = inp.stirrupDia !== undefined ? barDia(inp.stirrupDia, sys) : sys === "US" ? barDia(3, sys) : aci ? 10 : 8;
    const db = inp.bars ? barDia(inp.bars.dia, sys) : sys === "US" ? barDia(8, sys) : 20;
    d = inp.D - cover - sd - db / 2;
    steps.push(`d = D − cover − stirrup − db/2 = ${inp.D} − ${cover} − ${sd.toFixed(1)} − ${(db / 2).toFixed(1)} = ${d.toFixed(1)} mm (one layer of bars)`);
  }
  let Mn: number, phi: number, phiMn: number, a: number | undefined, c: number, et: number | undefined, AsMin: number;
  if (aci) {
    const b1 = beta1(fc);
    const ey = fy / ES;
    a = (As * fy) / (0.85 * fc * b);
    c = a / b1;
    et = (0.003 * (d - c)) / c;
    steps.push(`${CODES[code].label}: a = As·fy/(0.85·f'c·b) = ${As.toFixed(0)}×${fy}/(0.85×${fc}×${b}) = ${a.toFixed(1)} mm; β1 = ${b1.toFixed(3)}, c = a/β1 = ${c.toFixed(1)} mm`);
    let fs = fy;
    if (et < ey) {
      // Steel does not yield: 0.85f'c·β1·c·b = As·Es·0.003(d − c)/c → quadratic in c
      const A1 = 0.85 * fc * b1 * b, B1 = As * ES * 0.003, C1 = -As * ES * 0.003 * d;
      c = (-B1 + Math.sqrt(B1 * B1 - 4 * A1 * C1)) / (2 * A1);
      a = b1 * c;
      et = (0.003 * (d - c)) / c;
      fs = ES * et;
      steps.push(`εt < εy = ${ey.toFixed(4)}: steel does not yield. Strain compatibility gives c = ${c.toFixed(1)} mm, a = ${a.toFixed(1)} mm, fs = ${fs.toFixed(0)} MPa`);
    }
    phi = phiTied(code, fy, et);
    const lim = strainLimits(code, fy);
    steps.push(`εt = 0.003(d − c)/c = 0.003×(${d.toFixed(1)} − ${c.toFixed(1)})/${c.toFixed(1)} = ${et.toFixed(5)} → ${et >= lim.tension ? `tension-controlled (≥ ${lim.tension.toFixed(4)}), φ = 0.90` : `transition zone, φ = ${phi.toFixed(3)}`}`);
    Mn = (As * fs * (d - a / 2)) / 1e6;
    phiMn = phi * Mn;
    steps.push(`Mn = As·fs·(d − a/2) = ${As.toFixed(0)}×${fs.toFixed(0)}×(${d.toFixed(1)} − ${(a / 2).toFixed(1)}) = ${Mn.toFixed(1)} kN·m; φMn = ${phi.toFixed(2)}×${Mn.toFixed(1)} = ${phiMn.toFixed(1)} kN·m`);
    AsMin = (Math.max(0.25 * Math.sqrt(fc), 1.4) / fy) * b * d;
    checks.push({ name: "Minimum steel (ACI 9.6.1.2)", ok: As >= AsMin, detail: `As = ${As.toFixed(0)} mm² vs As,min = max(0.25√f'c, 1.4)·b·d/fy = ${AsMin.toFixed(0)} mm²` });
    checks.push({ name: "Ductility εt ≥ 0.004 (ACI 9.3.3.1)", ok: et >= 0.004, detail: `εt = ${et.toFixed(5)}` });
  } else {
    const xumax = xuMaxRatio(fy) * d;
    const xu = (0.87 * fy * As) / (0.36 * fc * b);
    c = xu;
    steps.push(`IS 456 Annex G-1.1: xu = 0.87fy·Ast/(0.36fck·b) = 0.87×${fy}×${As.toFixed(0)}/(0.36×${fc}×${b}) = ${xu.toFixed(1)} mm; xu,max = ${xuMaxRatio(fy)}d = ${xumax.toFixed(1)} mm`);
    if (xu <= xumax) {
      Mn = (0.87 * fy * As * (d - 0.42 * xu)) / 1e6;
      steps.push(`Under-reinforced: Mu = 0.87fy·Ast(d − 0.42xu) = ${Mn.toFixed(1)} kN·m`);
    } else {
      Mn = (0.36 * fc * b * xumax * (d - 0.42 * xumax)) / 1e6;
      steps.push(`Over-reinforced (xu > xu,max): Mu = Mu,lim = 0.36fck·b·xu,max(d − 0.42xu,max) = ${Mn.toFixed(1)} kN·m (extra steel adds no strength)`);
    }
    phi = 1; phiMn = Mn; // partial safety factors are inside the IS 456 stress block
    AsMin = (0.85 * b * d) / fy;
    checks.push({ name: "Minimum steel (IS 456 cl. 26.5.1.1)", ok: As >= AsMin, detail: `Ast = ${As.toFixed(0)} mm² vs 0.85·b·d/fy = ${AsMin.toFixed(0)} mm²` });
    checks.push({ name: "Under-reinforced (xu ≤ xu,max)", ok: xu <= xumax, detail: `xu = ${xu.toFixed(1)} mm vs ${xumax.toFixed(1)} mm` });
  }
  if (inp.Mu !== undefined) checks.push({ name: "Strength: Mu ≤ design strength", ok: inp.Mu <= phiMn + 1e-9, detail: `Mu = ${inp.Mu} kN·m vs ${aci ? "φMn" : "Mu,R"} = ${phiMn.toFixed(1)} kN·m (${((100 * inp.Mu) / phiMn).toFixed(0)}% used)` });
  return { code, As, d, a, c, et, phi, Mn, phiMn, AsMin, bars: barNote || undefined, ok: checks.every((x) => x.ok), steps, checks };
}
