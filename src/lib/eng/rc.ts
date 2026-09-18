/**
 * Reinforced concrete design helpers.
 * Codes supported: IS 456:2000 (limit state) and ACI 318-19 (strength design), SI units.
 * Inputs: dimensions mm, strengths MPa, forces kN, moments kN·m.
 *
 * These are preliminary-design calculators. Final designs must be checked by a licensed engineer.
 */

export type DesignCode = "IS456" | "ACI318";

export const BAR_SIZES_MM = [8, 10, 12, 16, 20, 25, 32] as const;
export const barArea = (d: number) => (Math.PI * d * d) / 4;

export interface BarChoice {
  diameter: number;
  count: number;
  areaProvided: number;
  label: string;
}

/** Choose a practical bar arrangement giving at least As required in a width b (mm). */
export function chooseBars(AsReq: number, b: number, cover = 25, stirrup = 8, minBars = 2, preferred?: number[]): BarChoice[] {
  const sizes = preferred ?? [12, 16, 20, 25, 32];
  const options: BarChoice[] = [];
  for (const d of sizes) {
    const a = barArea(d);
    const n = Math.max(minBars, Math.ceil(AsReq / a));
    // clear spacing check: (b - 2cover - 2stirrup - n·d)/(n-1) >= max(d, 25)
    const clear = (b - 2 * cover - 2 * stirrup - n * d) / Math.max(1, n - 1);
    if (n > 1 && clear < Math.max(d, 25)) continue;
    if (n > 8) continue;
    options.push({ diameter: d, count: n, areaProvided: n * a, label: `${n} × Ø${d} mm (${(n * a).toFixed(0)} mm²)` });
  }
  // Practical preference: 2–4 bars of a sensible size first (fewer, larger bars are easier to place), then by least steel.
  const rank = (o: BarChoice) => (o.count >= 2 && o.count <= 4 ? 0 : o.count <= 6 ? 1 : 2);
  return options.sort((p, q) => rank(p) - rank(q) || p.areaProvided - q.areaProvided);
}

// ---------------- IS 456 ----------------

export function xuMaxRatio(fy: number): number {
  if (fy <= 250) return 0.53;
  if (fy <= 415) return 0.48;
  return 0.46;
}

/** Design shear strength of concrete τc (MPa) per IS 456 Table 19 (closed form from SP:24). */
export function tauC_IS(fck: number, pt: number): number {
  const p = Math.max(0.15, Math.min(3, pt));
  const beta = Math.max(1, (0.8 * fck) / (6.89 * p));
  return (0.85 * Math.sqrt(0.8 * fck) * (Math.sqrt(1 + 5 * beta) - 1)) / (6 * beta);
}

export function tauCmax_IS(fck: number): number {
  const table: [number, number][] = [[15, 2.5], [20, 2.8], [25, 3.1], [30, 3.5], [35, 3.7], [40, 4.0]];
  for (const [f, t] of table) if (fck <= f) return t;
  return 4.0;
}

export interface RcBeamInput {
  code?: DesignCode;
  b: number; // mm
  D: number; // overall depth mm
  cover?: number; // clear cover mm (default 25)
  fck: number; // MPa (f'c for ACI)
  fy: number; // MPa
  Mu: number; // factored moment kN·m
  Vu?: number; // factored shear kN
  stirrupDia?: number;
  mainBarDia?: number; // assumed for effective depth (default 16)
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
  shear?: {
    tauV: number;
    tauC: number;
    tauCmax: number;
    Vus: number;
    stirrupSpacing: number;
    stirrupLabel: string;
    ok: boolean;
  };
  checks: { name: string; ok: boolean; detail: string }[];
  steps: string[];
}

export function designRcBeam(inp: RcBeamInput): RcBeamResult {
  const code = inp.code ?? "IS456";
  const cover = inp.cover ?? 25;
  const sd = inp.stirrupDia ?? 8;
  const db = inp.mainBarDia ?? 16;
  const { b, D, fck, fy } = inp;
  if (b <= 0 || D <= 0 || fck <= 0 || fy <= 0) throw new Error("b, D, fck, fy must be positive");
  const d = D - cover - sd - db / 2;
  const Mu = inp.Mu * 1e6; // N·mm
  const steps: string[] = [];
  const checks: RcBeamResult["checks"] = [];
  steps.push(`Effective depth d = D − cover − stirrup − bar/2 = ${D} − ${cover} − ${sd} − ${db / 2} = ${d.toFixed(1)} mm`);

  let AstRequired = 0;
  let AscRequired = 0;
  let MuLim: number | undefined;
  let singly = true;
  let AstMin: number;
  let AstMax: number;

  if (code === "IS456") {
    const k = xuMaxRatio(fy);
    MuLim = 0.36 * fck * b * (k * d) * (d - 0.42 * k * d); // N·mm
    steps.push(`xu,max/d = ${k} (Fe${fy}); Mu,lim = 0.36·fck·b·xu,max·(d − 0.42·xu,max) = ${(MuLim / 1e6).toFixed(2)} kN·m`);
    AstMin = (0.85 * b * d) / fy;
    AstMax = 0.04 * b * D;
    if (Mu <= MuLim) {
      // Mu = 0.87 fy Ast d (1 - fy Ast /(fck b d))  -> quadratic in Ast
      const A = (0.87 * fy * fy) / (fck * b);
      const B = -0.87 * fy * d;
      const C = Mu;
      const disc = B * B - 4 * A * C;
      AstRequired = disc >= 0 ? (-B - Math.sqrt(disc)) / (2 * A) : Number.NaN;
      steps.push(`Singly reinforced. Solve Mu = 0.87·fy·Ast·d·(1 − fy·Ast/(fck·b·d)) → Ast = ${AstRequired.toFixed(0)} mm²`);
    } else {
      singly = false;
      const Ast1 = MuLim / (0.87 * fy * (d - 0.42 * k * d));
      const dPrime = cover + sd + db / 2;
      const Mu2 = Mu - MuLim;
      // stress in compression steel: approx 0.87 fy for Fe415/500 if d'/d small (use fsc table simplification)
      const fsc = fy <= 250 ? 0.87 * fy : Math.min(0.87 * fy, fy * (fy <= 415 ? 0.85 : 0.83));
      AscRequired = Mu2 / ((fsc - 0.447 * fck) * (d - dPrime));
      const Ast2 = (AscRequired * (fsc - 0.447 * fck)) / (0.87 * fy);
      AstRequired = Ast1 + Ast2;
      steps.push(`Mu > Mu,lim → doubly reinforced. Ast1 = ${Ast1.toFixed(0)} mm², Mu2 = ${(Mu2 / 1e6).toFixed(2)} kN·m, Asc = ${AscRequired.toFixed(0)} mm² (d' = ${dPrime} mm, fsc ≈ ${fsc.toFixed(0)} MPa), Ast2 = ${Ast2.toFixed(0)} mm²`);
    }
  } else {
    // ACI 318-19 strength design, phi = 0.9 (tension-controlled assumed then checked)
    const phi = 0.9;
    const beta1 = fck <= 28 ? 0.85 : Math.max(0.65, 0.85 - (0.05 * (fck - 28)) / 7);
    AstMin = Math.max((0.25 * Math.sqrt(fck)) / fy, 1.4 / fy) * b * d;
    // Ast max for tension controlled: εt = 0.005 -> c/d = 0.375
    const cMax = 0.375 * d;
    AstMax = (0.85 * fck * b * beta1 * cMax) / fy;
    // Mu/phi = As fy (d - a/2), a = As fy / (0.85 fck b)
    const A = (fy * fy) / (2 * 0.85 * fck * b);
    const B = -fy * d;
    const C = Mu / phi;
    const disc = B * B - 4 * A * C;
    if (disc < 0) {
      singly = false;
      AstRequired = AstMax;
      const MnMax = AstMax * fy * (d - (AstMax * fy) / (2 * 0.85 * fck * b));
      const Mu2 = Mu / phi - MnMax;
      const dPrime = cover + sd + db / 2;
      AscRequired = Mu2 / (fy * (d - dPrime));
      AstRequired = AstMax + AscRequired;
      steps.push(`Section cannot remain tension-controlled singly reinforced. Add compression steel Asc = ${AscRequired.toFixed(0)} mm²`);
    } else {
      AstRequired = (-B - Math.sqrt(disc)) / (2 * A);
      const a = (AstRequired * fy) / (0.85 * fck * b);
      const c = a / beta1;
      const et = (0.003 * (d - c)) / c;
      steps.push(`β1 = ${beta1.toFixed(3)}; solve Mu/φ = As·fy·(d − a/2) → As = ${AstRequired.toFixed(0)} mm², a = ${a.toFixed(1)} mm, c = ${c.toFixed(1)} mm, εt = ${et.toFixed(4)} (${et >= 0.005 ? "tension-controlled, φ = 0.9" : "NOT tension-controlled — increase section"})`);
      checks.push({ name: "Tension-controlled (εt ≥ 0.005)", ok: et >= 0.005, detail: `εt = ${et.toFixed(4)}` });
      if (AstRequired > AstMax) singly = false;
    }
  }

  const AstDesign = Math.max(AstRequired, AstMin);
  checks.push({ name: "Ast ≥ Ast,min", ok: AstRequired >= AstMin, detail: `Ast,min = ${AstMin.toFixed(0)} mm² (${AstRequired < AstMin ? "governs — provide Ast,min" : "ok"})` });
  checks.push({ name: "Ast ≤ Ast,max", ok: AstDesign <= AstMax, detail: `Ast,max = ${AstMax.toFixed(0)} mm²` });

  const tensionBars = chooseBars(AstDesign, b, cover, sd);
  const compressionBars = AscRequired > 0 ? chooseBars(AscRequired, b, cover, sd) : undefined;
  const provided = tensionBars[0]?.areaProvided ?? AstDesign;
  const pt = (100 * provided) / (b * d);

  let shear: RcBeamResult["shear"];
  if (inp.Vu !== undefined) {
    const Vu = inp.Vu * 1e3;
    const tauV = Vu / (b * d);
    const legs = 2;
    const Asv = legs * barArea(sd);
    if (code === "IS456") {
      const tauC = tauC_IS(fck, pt);
      const tauCmax = tauCmax_IS(fck);
      const Vus = Math.max(0, Vu - tauC * b * d);
      let sv = Vus > 0 ? (0.87 * fy * Asv * d) / Vus : Infinity;
      const svMin = (0.87 * fy * Asv) / (0.4 * b); // minimum shear reinforcement
      sv = Math.min(sv, svMin, 0.75 * d, 300);
      sv = Math.floor(sv / 10) * 10;
      shear = { tauV, tauC, tauCmax, Vus: Vus / 1e3, stirrupSpacing: sv, stirrupLabel: `${legs}-legged Ø${sd} @ ${sv} mm c/c`, ok: tauV <= tauCmax };
      steps.push(`Shear: τv = Vu/(b·d) = ${tauV.toFixed(3)} MPa; τc = ${tauC.toFixed(3)} MPa (pt = ${pt.toFixed(2)}%); τc,max = ${tauCmax} MPa; Vus = ${(Vus / 1e3).toFixed(1)} kN → ${shear.stirrupLabel}`);
      checks.push({ name: "τv ≤ τc,max", ok: tauV <= tauCmax, detail: `${tauV.toFixed(3)} ≤ ${tauCmax}` });
    } else {
      const phiV = 0.75;
      const Vc = 0.17 * Math.sqrt(fck) * b * d;
      const Vs = Math.max(0, Vu / phiV - Vc);
      const VsMax = 0.66 * Math.sqrt(fck) * b * d;
      let s = Vs > 0 ? (Asv * fy * d) / Vs : Infinity;
      const sMax = Vs <= 0.33 * Math.sqrt(fck) * b * d ? Math.min(d / 2, 600) : Math.min(d / 4, 300);
      const sMin = Math.min((Asv * fy) / (0.062 * Math.sqrt(fck) * b), (Asv * fy) / (0.35 * b));
      s = Math.min(s, sMax, sMin);
      s = Math.floor(s / 10) * 10;
      shear = { tauV: Vu / (b * d), tauC: Vc / (b * d), tauCmax: (Vc + VsMax) / (b * d), Vus: Vs / 1e3, stirrupSpacing: s, stirrupLabel: `${legs}-leg Ø${sd} @ ${s} mm`, ok: Vs <= VsMax };
      steps.push(`Shear (ACI): Vc = 0.17√f'c·b·d = ${(Vc / 1e3).toFixed(1)} kN; Vs req = Vu/φ − Vc = ${(Vs / 1e3).toFixed(1)} kN → ${shear.stirrupLabel}`);
      checks.push({ name: "Vs ≤ 0.66√f'c·b·d", ok: Vs <= VsMax, detail: `${(Vs / 1e3).toFixed(1)} ≤ ${(VsMax / 1e3).toFixed(1)} kN` });
    }
  }

  return {
    code,
    d,
    MuLim: MuLim !== undefined ? MuLim / 1e6 : undefined,
    singlyReinforced: singly,
    AstRequired: AstDesign,
    AstMin,
    AstMax,
    AscRequired,
    ptProvidedPercent: pt,
    tensionBars,
    compressionBars,
    shear,
    checks,
    steps,
  };
}

// ---------------- Columns ----------------

export interface RcColumnInput {
  code?: DesignCode;
  b: number;
  D: number;
  fck: number;
  fy: number;
  Pu: number; // factored axial load kN
  unsupportedLength?: number; // mm, for slenderness check
  /** if provided, checks capacity for given steel percentage instead of designing */
  steelPercent?: number;
}
export interface RcColumnResult {
  code: DesignCode;
  Ag: number;
  AscRequired: number;
  steelPercent: number;
  capacity: number; // kN with Asc provided
  bars: BarChoice[];
  ties: string;
  slenderness: { ratio: number; short: boolean };
  checks: { name: string; ok: boolean; detail: string }[];
  steps: string[];
}

export function designRcColumn(inp: RcColumnInput): RcColumnResult {
  const code = inp.code ?? "IS456";
  const { b, D, fck, fy } = inp;
  const Pu = inp.Pu * 1e3;
  const Ag = b * D;
  const steps: string[] = [];
  const checks: RcColumnResult["checks"] = [];
  const lu = inp.unsupportedLength ?? 3000;
  const ratio = lu / Math.min(b, D);
  const short = ratio <= 12;
  steps.push(`Slenderness lu/min(b,D) = ${ratio.toFixed(1)} → ${short ? "short column" : "slender column (moment magnification required — not covered here)"}`);
  let Asc: number;
  let capacityFn: (A: number) => number;
  if (code === "IS456") {
    // Pu = 0.4 fck Ac + 0.67 fy Asc (IS 456 cl. 39.3, min eccentricity assumed satisfied)
    capacityFn = (A) => 0.4 * fck * (Ag - A) + 0.67 * fy * A;
    Asc = (Pu - 0.4 * fck * Ag) / (0.67 * fy - 0.4 * fck);
    steps.push(`IS 456 cl.39.3: Pu = 0.4·fck·Ac + 0.67·fy·Asc → Asc = ${Asc.toFixed(0)} mm²`);
  } else {
    // ACI 318-19 tied column: φPn,max = 0.65 × 0.80 × [0.85 f'c (Ag − Ast) + fy Ast]
    capacityFn = (A) => 0.65 * 0.8 * (0.85 * fck * (Ag - A) + fy * A);
    Asc = (Pu / (0.65 * 0.8) - 0.85 * fck * Ag) / (fy - 0.85 * fck);
    steps.push(`ACI 318-19 22.4.2: φPn,max = 0.52·[0.85·f'c·(Ag − Ast) + fy·Ast] → Ast = ${Asc.toFixed(0)} mm²`);
  }
  const minPct = code === "IS456" ? 0.8 : 1.0;
  const maxPct = code === "IS456" ? 4.0 : 8.0;
  const AscMin = (minPct / 100) * Ag;
  const AscDesign = Math.max(Asc, AscMin);
  if (inp.steelPercent !== undefined) {
    const A = (inp.steelPercent / 100) * Ag;
    const cap = capacityFn(A) / 1e3;
    checks.push({ name: "Capacity ≥ Pu", ok: cap >= inp.Pu, detail: `Capacity with ${inp.steelPercent}% steel = ${cap.toFixed(0)} kN vs Pu = ${inp.Pu} kN` });
  }
  const pct = (100 * AscDesign) / Ag;
  checks.push({ name: `Steel ≥ ${minPct}%`, ok: AscDesign >= AscMin, detail: `${pct.toFixed(2)}% provided (min ${minPct}%)` });
  checks.push({ name: `Steel ≤ ${maxPct}%`, ok: pct <= maxPct, detail: pct > maxPct ? "Increase section size" : "ok" });
  checks.push({ name: "Short column", ok: short, detail: `lu/b = ${ratio.toFixed(1)}` });
  const bars = chooseBars(AscDesign, Math.min(b, D), 40, 8, 4, [12, 16, 20, 25, 32]).filter((o) => o.count % 2 === 0 || o.count >= 4);
  const mainD = bars[0]?.diameter ?? 16;
  const tieD = Math.max(6, Math.ceil(mainD / 4));
  const tieSpacing = Math.min(Math.min(b, D), 16 * mainD, 300);
  return {
    code,
    Ag,
    AscRequired: AscDesign,
    steelPercent: pct,
    capacity: capacityFn(bars[0]?.areaProvided ?? AscDesign) / 1e3,
    bars,
    ties: `Ø${tieD} lateral ties @ ${Math.floor(tieSpacing / 10) * 10} mm c/c`,
    slenderness: { ratio, short },
    checks,
    steps,
  };
}

// ---------------- One-way slab ----------------

export interface SlabInput {
  code?: DesignCode;
  span: number; // m, effective span (short direction for one-way)
  liveLoad: number; // kN/m²
  floorFinish?: number; // kN/m² (default 1.0)
  fck: number;
  fy: number;
  cover?: number; // default 20
  support?: "simply_supported" | "continuous" | "cantilever";
  thickness?: number; // mm, optional override
}
export interface SlabResult {
  thickness: number;
  d: number;
  selfWeight: number;
  totalLoad: number;
  factoredLoad: number;
  Mu: number;
  Vu: number;
  AstRequired: number;
  AstMin: number;
  mainBars: string;
  distributionBars: string;
  deflectionCheck: { ok: boolean; detail: string };
  shearCheck: { ok: boolean; detail: string };
  steps: string[];
}

export function designOneWaySlab(inp: SlabInput): SlabResult {
  const code = inp.code ?? "IS456";
  const cover = inp.cover ?? 20;
  const support = inp.support ?? "simply_supported";
  const L = inp.span;
  const steps: string[] = [];
  const baseRatio = support === "cantilever" ? 7 : support === "continuous" ? 26 : 20;
  const ratio = baseRatio * (inp.fy <= 250 ? 1.0 : inp.fy <= 415 ? 1.25 : 1.15); // approx modification factor for typical pt
  const dReq = (L * 1000) / ratio;
  const barD = 10;
  let thickness = inp.thickness ?? Math.ceil((dReq + cover + barD / 2) / 10) * 10;
  thickness = Math.max(thickness, 100);
  const d = thickness - cover - barD / 2;
  steps.push(`Span/depth ratio ${ratio.toFixed(1)} → d,req = ${dReq.toFixed(0)} mm → thickness D = ${thickness} mm, d = ${d.toFixed(0)} mm`);
  const selfWeight = (thickness / 1000) * 25;
  const ff = inp.floorFinish ?? 1.0;
  const total = selfWeight + ff + inp.liveLoad;
  const lf = code === "IS456" ? 1.5 : 1.0;
  const factored = code === "IS456" ? lf * total : 1.2 * (selfWeight + ff) + 1.6 * inp.liveLoad;
  steps.push(`Loads (per m width): self ${selfWeight.toFixed(2)} + finish ${ff} + live ${inp.liveLoad} = ${total.toFixed(2)} kN/m²; factored wu = ${factored.toFixed(2)} kN/m`);
  const mCoef = support === "cantilever" ? 0.5 : support === "continuous" ? 1 / 10 : 1 / 8;
  const Mu = mCoef * factored * L * L;
  const Vu = (support === "cantilever" ? 1 : 0.5) * factored * L * (support === "continuous" ? 1.15 : 1);
  steps.push(`Mu = ${support === "cantilever" ? "wL²/2" : support === "continuous" ? "wL²/10" : "wL²/8"} = ${Mu.toFixed(2)} kN·m/m; Vu = ${Vu.toFixed(2)} kN/m`);
  const beam = designRcBeam({ code, b: 1000, D: thickness, cover, fck: inp.fck, fy: inp.fy, Mu, Vu, stirrupDia: 0, mainBarDia: barD });
  const AstMin = code === "IS456" ? (inp.fy <= 250 ? 0.0015 : 0.0012) * 1000 * thickness : 0.0018 * 1000 * thickness;
  const Ast = Math.max(beam.AstRequired, AstMin);
  const spacingFor = (area: number, dia: number) => Math.min(Math.floor((1000 * barArea(dia)) / area / 10) * 10, 3 * thickness, 300);
  const mainSp = spacingFor(Ast, barD);
  const distSp = spacingFor(AstMin, 8);
  const ptProv = (100 * ((1000 * barArea(barD)) / mainSp)) / (1000 * d);
  const tauV = (Vu * 1e3) / (1000 * d);
  const tauC = code === "IS456" ? tauC_IS(inp.fck, ptProv) * (thickness <= 150 ? 1.3 : thickness >= 300 ? 1.0 : 1.3 - (0.3 * (thickness - 150)) / 150) : (0.75 * 0.17 * Math.sqrt(inp.fck));
  steps.push(`Ast = ${Ast.toFixed(0)} mm²/m → Ø${barD} @ ${mainSp} mm c/c; distribution Ø8 @ ${distSp} mm c/c`);
  return {
    thickness,
    d,
    selfWeight,
    totalLoad: total,
    factoredLoad: factored,
    Mu,
    Vu,
    AstRequired: Ast,
    AstMin,
    mainBars: `Ø${barD} @ ${mainSp} mm c/c (${((1000 * barArea(barD)) / mainSp).toFixed(0)} mm²/m)`,
    distributionBars: `Ø8 @ ${distSp} mm c/c`,
    deflectionCheck: { ok: d >= dReq, detail: `d = ${d.toFixed(0)} ≥ d,req = ${dReq.toFixed(0)} mm (span/depth)` },
    shearCheck: { ok: tauV <= tauC, detail: `τv = ${tauV.toFixed(3)} MPa ≤ k·τc = ${tauC.toFixed(3)} MPa` },
    steps,
  };
}

// ---------------- Isolated footing ----------------

export interface FootingInput {
  code?: DesignCode;
  columnB: number; // mm
  columnD: number; // mm
  serviceLoad: number; // kN (unfactored)
  safeBearingCapacity: number; // kN/m²
  fck: number;
  fy: number;
  cover?: number; // default 50
  loadFactor?: number; // default 1.5 (IS) / 1.4 (ACI approx)
}
export interface FootingResult {
  areaRequired: number; // m²
  side: number; // m (square)
  netUpwardPressure: number; // kN/m² factored
  depth: number; // overall mm
  d: number;
  Mu: number; // kN·m per full width
  AstRequired: number;
  bars: string;
  oneWayShear: { ok: boolean; detail: string };
  punchingShear: { ok: boolean; detail: string };
  steps: string[];
}

export function designIsolatedFooting(inp: FootingInput): FootingResult {
  const code = inp.code ?? "IS456";
  const cover = inp.cover ?? 50;
  const lf = inp.loadFactor ?? (code === "IS456" ? 1.5 : 1.4);
  const steps: string[] = [];
  const P = inp.serviceLoad;
  const areaReq = (P * 1.1) / inp.safeBearingCapacity; // 10% self weight
  const side = Math.ceil(Math.sqrt(areaReq) * 20) / 20; // round up to 50 mm
  steps.push(`Area = 1.1·P/SBC = 1.1×${P}/${inp.safeBearingCapacity} = ${areaReq.toFixed(2)} m² → square ${side} × ${side} m`);
  const pu = (lf * P) / (side * side);
  steps.push(`Factored net upward pressure pu = ${lf}×${P}/${(side * side).toFixed(2)} = ${pu.toFixed(1)} kN/m²`);
  const B = side * 1000; // mm
  const cb = inp.columnB;
  const cd = inp.columnD;
  const cantilever = (B - cb) / 2; // mm, along B measured from face of column
  const Mu = (pu * (cantilever / 1000) ** 2 * side) / 2; // kN·m (full width)
  steps.push(`Bending at column face: Mu = pu·l²·B/2 = ${Mu.toFixed(1)} kN·m over full width`);
  // Iterate depth for shear
  let D = 300;
  let oneWay = { ok: false, detail: "" };
  let punching = { ok: false, detail: "" };
  let d = 0;
  for (; D <= 2000; D += 50) {
    d = D - cover - 16;
    // one-way shear at distance d from column face
    const Vu1 = (pu * side * (cantilever - d)) / 1000; // kN
    const tauV1 = (Vu1 * 1e3) / (B * d);
    const tauC1 = code === "IS456" ? tauC_IS(inp.fck, 0.25) : 0.75 * 0.17 * Math.sqrt(inp.fck);
    // punching shear at d/2 from column face
    const bo = 2 * (cb + d + cd + d);
    const Vu2 = pu * (side * side - ((cb + d) * (cd + d)) / 1e6);
    const tauV2 = (Vu2 * 1e3) / (bo * d);
    const tauC2 = code === "IS456" ? 0.25 * Math.sqrt(inp.fck) * Math.min(1, 0.5 + Math.min(cb, cd) / Math.max(cb, cd)) : 0.75 * 0.33 * Math.sqrt(inp.fck);
    oneWay = { ok: tauV1 <= tauC1, detail: `τv = ${tauV1.toFixed(3)} MPa vs τc = ${tauC1.toFixed(3)} MPa at d from face` };
    punching = { ok: tauV2 <= tauC2, detail: `τv = ${tauV2.toFixed(3)} MPa vs allowable ${tauC2.toFixed(3)} MPa at d/2 from face (bo = ${bo.toFixed(0)} mm)` };
    if (oneWay.ok && punching.ok) break;
  }
  steps.push(`Depth from shear checks: D = ${D} mm, d = ${d} mm`);
  const beam = designRcBeam({ code, b: B, D, cover, fck: inp.fck, fy: inp.fy, Mu, stirrupDia: 0, mainBarDia: 16 });
  const AstMin = 0.0012 * B * D;
  const Ast = Math.max(beam.AstRequired, AstMin);
  const sp = Math.min(Math.floor((B * barArea(16)) / Ast / 10) * 10, 300);
  steps.push(`Ast = ${Ast.toFixed(0)} mm² over ${side} m → Ø16 @ ${sp} mm c/c both ways`);
  return {
    areaRequired: areaReq,
    side,
    netUpwardPressure: pu,
    depth: D,
    d,
    Mu,
    AstRequired: Ast,
    bars: `Ø16 @ ${sp} mm c/c both ways (bottom)`,
    oneWayShear: oneWay,
    punchingShear: punching,
    steps,
  };
}
