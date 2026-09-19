/**
 * Structural steel I-beams: bending with lateral-torsional buckling, shear (incl. high-shear moment reduction),
 * section class and deflection.
 * IS 800:2007 limit-state (γm0 = 1.10; cl. 8.2, Annex E, cl. 9.2, Table 2) and AISC 360-16 LRFD (F2, G2, Table B4.1b).
 *
 * Section data:
 *  - ISMB: IS 808:2021 Table 1 (current standard; publishes Zp, It and Iw). Seven sizes (100, 125, 150, 175, 200, 300,
 *    600) differ from the legacy SP 6(1):1964 tables still found in older textbooks.
 *  - W-shapes: AISC Shapes Database v15.0, converted to SI.
 * Units in this file: mm, N, MPa internally; section table in the units noted per field.
 */

export interface SteelSection {
  name: string;
  mass: number; // kg/m
  h: number; bf: number; tf: number; tw: number; // mm
  A: number; // cm²
  Ix: number; Iy: number; // cm⁴
  Zx: number; Zpx: number; // elastic / plastic modulus about x, cm³
  ry: number; // cm
  It: number; // torsion constant cm⁴
  Iw: number; // warping constant cm⁶
  source: "IS 808:2021" | "AISC v15";
}

// IS 808:2021 Table 1 (h, bf, tf, tw mm; A cm²; I cm⁴; Z cm³; r cm; It cm⁴; Iw cm⁶)
const ISMB: [string, number, number, number, number, number, number, number, number, number, number, number, number, number][] = [
  // name, kg/m, A, h, bf, tf, tw, Ixx, Iyy, ryy, Zxx, Zpx, It, Iw
  ["ISMB 100", 8.95, 11.4, 100, 50, 7.0, 4.7, 182, 12.5, 1.04, 36.4, 42.6, 2.15, 315],
  ["ISMB 125", 13.35, 17.0, 125, 70, 8.0, 5.0, 445, 38.4, 1.5, 71.3, 82.1, 3.99, 1560],
  ["ISMB 150", 14.96, 19.0, 150, 75, 8.0, 5.0, 718, 46.7, 1.56, 95.7, 109, 4.36, 2830],
  ["ISMB 175", 19.5, 24.8, 175, 85, 9.0, 5.8, 1260, 76.6, 1.75, 144, 165, 7.17, 6340],
  ["ISMB 200", 24.17, 30.8, 200, 100, 10.0, 5.7, 2110, 136, 2.1, 211, 240, 10.7, 15000],
  ["ISMB 250", 37.3, 47.5, 250, 125, 12.5, 6.9, 5130, 334, 2.65, 410, 465, 25.5, 57300],
  ["ISMB 300", 46.02, 58.6, 300, 140, 13.1, 7.7, 8990, 486, 2.87, 599, 681, 34.7, 123000],
  ["ISMB 350", 52.33, 66.7, 350, 140, 14.2, 8.1, 13600, 537, 2.83, 779, 889, 43.1, 183000],
  ["ISMB 400", 61.55, 78.4, 400, 140, 16.0, 8.9, 20400, 622, 2.81, 1020, 1170, 59.6, 269000],
  ["ISMB 450", 72.38, 92.2, 450, 150, 17.4, 9.4, 30400, 834, 3.0, 1350, 1550, 81.0, 457000],
  ["ISMB 500", 86.88, 110, 500, 180, 17.2, 10.2, 45200, 1360, 3.51, 1800, 2070, 103, 974000],
  ["ISMB 550", 103.64, 132, 550, 190, 19.3, 11.2, 64900, 1830, 3.72, 2360, 2710, 150, 1550000],
  ["ISMB 600", 121.0, 154, 600, 210, 20.3, 12.0, 90200, 2570, 4.08, 3000, 3450, 198, 2630000],
];
// AISC v15 (US units): name, lb/ft, A in², d, bf, tf, tw in, Ix, Iy in⁴, Sx, Zx in³, ry in, J in⁴, Cw in⁶
const W_US: [string, number, number, number, number, number, number, number, number, number, number, number, number, number][] = [
  ["W8x18", 18, 5.26, 8.14, 5.25, 0.33, 0.23, 61.9, 7.97, 15.2, 17.0, 1.23, 0.172, 122],
  ["W10x22", 22, 6.49, 10.2, 5.75, 0.36, 0.24, 118, 11.4, 23.2, 26.0, 1.33, 0.239, 275],
  ["W12x26", 26, 7.65, 12.2, 6.49, 0.38, 0.23, 204, 17.3, 33.4, 37.2, 1.51, 0.3, 607],
  ["W14x30", 30, 8.85, 13.8, 6.73, 0.385, 0.27, 291, 19.6, 42.0, 47.3, 1.49, 0.38, 887],
  ["W16x36", 36, 10.6, 15.9, 6.99, 0.43, 0.295, 448, 24.5, 56.5, 64.0, 1.52, 0.545, 1460],
  ["W18x50", 50, 14.7, 18.0, 7.5, 0.57, 0.355, 800, 40.1, 88.9, 101, 1.65, 1.24, 3040],
  ["W21x62", 62, 18.3, 21.0, 8.24, 0.615, 0.4, 1330, 57.5, 127, 144, 1.77, 1.83, 5960],
  ["W24x76", 76, 22.4, 23.9, 8.99, 0.68, 0.44, 2100, 82.5, 176, 200, 1.92, 2.68, 11100],
];
const IN = 25.4;

export const SECTIONS: SteelSection[] = [
  ...ISMB.map(([name, mass, A, h, bf, tf, tw, Ix, Iy, ry, Zx, Zpx, It, Iw]) => ({ name, mass, A, h, bf, tf, tw, Ix, Iy, ry, Zx, Zpx, It, Iw, source: "IS 808:2021" as const })),
  ...W_US.map(([name, lbft, A, d, bf, tf, tw, Ix, Iy, Sx, Zx, ry, J, Cw]) => ({
    name, mass: lbft * 1.48816, A: A * 6.4516, h: d * IN, bf: bf * IN, tf: tf * IN, tw: tw * IN,
    Ix: (Ix * IN ** 4) / 1e4, Iy: (Iy * IN ** 4) / 1e4, Zx: (Sx * IN ** 3) / 1e3, Zpx: (Zx * IN ** 3) / 1e3, ry: (ry * IN) / 10,
    It: (J * IN ** 4) / 1e4, Iw: (Cw * IN ** 6) / 1e6, source: "AISC v15" as const,
  })),
];

export function findSection(name: string): SteelSection | undefined {
  const n = name.toLowerCase().replace(/\s+/g, "");
  return SECTIONS.find((s) => s.name.toLowerCase().replace(/\s+/g, "") === n);
}

const E = 200000, G = 76900; // MPa (IS 800 cl. 2.2.4.1); AISC uses E = 200 000 MPa (29 000 ksi), G = 77 200 MPa

/** IS 800 Annex E-1.1 elastic critical moment for a doubly symmetric I-section loaded at the shear centre. N·mm. */
export function mcrIS800(s: { Iy: number; It: number; Iw: number }, LLT: number, c1 = 1.0): number {
  const Iy = s.Iy * 1e4, It = s.It * 1e4, Iw = s.Iw * 1e6; // mm⁴, mm⁴, mm⁶
  const pe = (Math.PI ** 2 * E * Iy) / LLT ** 2;
  return c1 * Math.sqrt(pe * (G * It + (Math.PI ** 2 * E * Iw) / LLT ** 2));
}

/** IS 800 cl. 8.2.2: design bending strength of a laterally unsupported beam (rolled section, αLT = 0.21). */
export function isLTB(Zp: number, fy: number, Mcr: number, betaB = 1, alphaLT = 0.21) {
  const lam = Math.sqrt((betaB * Zp * fy) / Mcr);
  const phiLT = 0.5 * (1 + alphaLT * (lam - 0.2) + lam * lam);
  const chi = lam <= 0.4 ? 1 : Math.min(1, 1 / (phiLT + Math.sqrt(phiLT * phiLT - lam * lam))); // λLT ≤ 0.4: no LTB reduction
  const fbd = (chi * fy) / 1.1;
  return { lambdaLT: lam, phiLT, chiLT: chi, fbd, Md: betaB * Zp * fbd };
}

/** AISC 360-16 F2 nominal flexural strength of a compact doubly symmetric I-shape (N·mm), with Lp and Lr (mm). */
export function aiscF2(s: SteelSection, Fy: number, Lb: number, Cb = 1.0) {
  const Es = 200000;
  const Sx = s.Zx * 1e3, Zx = s.Zpx * 1e3, ry = s.ry * 10, J = s.It * 1e4, Cw = s.Iw * 1e6, Iy = s.Iy * 1e4;
  const ho = s.h - s.tf;
  const rts = Math.sqrt(Math.sqrt(Iy * Cw) / Sx); // F2-7
  const Mp = Fy * Zx;
  const Lp = 1.76 * ry * Math.sqrt(Es / Fy); // F2-5
  const jc = J / (Sx * ho);
  const Lr = 1.95 * rts * (Es / (0.7 * Fy)) * Math.sqrt(jc + Math.sqrt(jc * jc + 6.76 * ((0.7 * Fy) / Es) ** 2)); // F2-6
  let Mn: number, zone: string;
  if (Lb <= Lp) { Mn = Mp; zone = "Lb ≤ Lp: plastic moment (F2-1)"; }
  else if (Lb <= Lr) { Mn = Math.min(Mp, Cb * (Mp - (Mp - 0.7 * Fy * Sx) * ((Lb - Lp) / (Lr - Lp)))); zone = "Lp < Lb ≤ Lr: inelastic LTB (F2-2)"; }
  else { const Fcr = ((Cb * Math.PI ** 2 * Es) / (Lb / rts) ** 2) * Math.sqrt(1 + 0.078 * jc * (Lb / rts) ** 2); Mn = Math.min(Mp, Fcr * Sx); zone = "Lb > Lr: elastic LTB (F2-3, F2-4)"; }
  return { Mn, Mp, Lp, Lr, rts, zone };
}

export interface SteelBeamInput {
  code?: "IS800" | "AISC";
  span: number; // m
  support?: "simply_supported" | "cantilever";
  factoredUDL?: number; // kN/m
  factoredPointLoad?: number; // kN at midspan (simply supported) or tip (cantilever)
  serviceUDL?: number; // kN/m, for deflection
  servicePointLoad?: number;
  factoredMoment?: number; // kN·m, overrides loads
  fy?: number; // MPa (default 250 IS / 345 AISC A992)
  section?: string; // check a specific section
  deflectionLimit?: number; // span/L (default 300 SS / 150 cantilever IS 800 Table 6; 360 AISC live load)
  lateralSupport?: boolean; // true (default): compression flange continuously restrained
  unbracedLength?: number; // m, compression flange unbraced length (default = span when lateralSupport is false)
  momentFactor?: number; // c1 (IS) / Cb (AISC) for the moment shape (default 1.0, conservative)
}

export function designSteelBeam(inp: SteelBeamInput) {
  const code = inp.code ?? "IS800";
  const fy = inp.fy ?? (code === "IS800" ? 250 : 345);
  const L = inp.span;
  const cant = inp.support === "cantilever";
  const w = inp.factoredUDL ?? 0;
  const P = inp.factoredPointLoad ?? 0;
  const Mu = inp.factoredMoment ?? (cant ? (w * L * L) / 2 + P * L : (w * L * L) / 8 + (P * L) / 4);
  if (!(Mu > 0)) throw new Error("Provide factoredMoment, factoredUDL or factoredPointLoad");
  const Vu = cant ? w * L + P : (w * L) / 2 + P / 2;
  const defLim = inp.deflectionLimit ?? (cant ? 150 : code === "IS800" ? 300 : 360);
  const restrained = inp.lateralSupport !== false && inp.unbracedLength === undefined;
  const Lb = (inp.unbracedLength ?? L) * 1000;
  const cmf = inp.momentFactor ?? 1.0;
  const ws = inp.serviceUDL, Ps = inp.servicePointLoad;
  const hasService = ws !== undefined || Ps !== undefined;
  const Lmm = L * 1000;
  const deflFor = (I: number) => cant ? ((ws ?? 0) * Lmm ** 4) / (8 * E * I) + ((Ps ?? 0) * 1e3 * Lmm ** 3) / (3 * E * I) : (5 * (ws ?? 0) * Lmm ** 4) / (384 * E * I) + ((Ps ?? 0) * 1e3 * Lmm ** 3) / (48 * E * I);
  const pool = inp.section ? SECTIONS.filter((s) => findSection(inp.section!)?.name === s.name) : SECTIONS.filter((s) => (code === "IS800" ? s.source === "IS 808:2021" : s.source === "AISC v15"));
  if (inp.section && !pool.length) throw new Error(`Unknown section "${inp.section}". Known: ${SECTIONS.map((s) => s.name).join(", ")}`);

  const candidates = pool.map((s) => {
    const Zp = s.Zpx * 1e3, Ze = s.Zx * 1e3, I = s.Ix * 1e4;
    const notes: string[] = [];
    let Mcap: number, Vcap: number, sectionClass: string, ltb = "";
    if (code === "IS800") {
      const eps = Math.sqrt(250 / fy);
      const bt = s.bf / 2 / s.tf, dt = (s.h - 2 * s.tf) / s.tw; // Table 2: outstand of rolled flange, web depth/thickness
      sectionClass = bt <= 9.4 * eps && dt <= 84 * eps ? "plastic" : bt <= 10.5 * eps && dt <= 105 * eps ? "compact" : bt <= 15.7 * eps && dt <= 126 * eps ? "semi-compact" : "slender";
      const betaB = sectionClass === "semi-compact" ? Ze / Zp : 1;
      const cap = ((cant ? 1.5 : 1.2) * Ze * fy) / 1.1; // cl. 8.2.1.2
      let Md = Math.min((betaB * Zp * fy) / 1.1, cap);
      if (!restrained) {
        const Mcr = mcrIS800(s, Lb, cmf);
        const r = isLTB(Zp, fy, Mcr, betaB);
        Md = Math.min(r.Md, cap);
        ltb = `Mcr = ${(Mcr / 1e6).toFixed(1)} kN·m, λLT = ${r.lambdaLT.toFixed(3)}, χLT = ${r.chiLT.toFixed(3)}, fbd = ${r.fbd.toFixed(1)} MPa (IS 800 cl. 8.2.2, Annex E)`;
      }
      Vcap = (s.h * s.tw * fy) / (Math.sqrt(3) * 1.1); // cl. 8.4.1
      if (Vu * 1e3 > 0.6 * Vcap) {
        // cl. 9.2.2 high shear: Mdv = Md − β(Md − Mfd), β = (2V/Vd − 1)², Mfd = plastic moment of the flanges alone
        const beta = (2 * (Vu * 1e3) / Vcap - 1) ** 2;
        const Mfd = ((Zp - (s.h * s.h * s.tw) / 4) * fy) / 1.1;
        Md = Md - beta * (Md - Mfd);
        notes.push(`high shear (V > 0.6Vd): moment reduced per cl. 9.2.2 (β = ${beta.toFixed(3)})`);
      }
      Mcap = Md;
      if (sectionClass === "slender") notes.push("slender section: not covered, choose another section");
    } else {
      const lf = s.bf / (2 * s.tf), lw = (s.h - 2 * s.tf) / s.tw;
      sectionClass = lf <= 0.38 * Math.sqrt(E / fy) && lw <= 3.76 * Math.sqrt(E / fy) ? "compact" : "noncompact";
      const f2 = aiscF2(s, fy, restrained ? 0 : Lb, cmf);
      Mcap = 0.9 * f2.Mn;
      if (!restrained) ltb = `Lp = ${(f2.Lp / 1000).toFixed(2)} m, Lr = ${(f2.Lr / 1000).toFixed(2)} m, Cb = ${cmf}: ${f2.zone}`;
      const hw = s.h - 2 * s.tf;
      const phiV = hw / s.tw <= 2.24 * Math.sqrt(E / fy) ? 1.0 : 0.9; // G2.1(a): rolled I-shapes
      Vcap = phiV * 0.6 * fy * s.h * s.tw; // G2-1, Cv1 = 1.0
      if (sectionClass !== "compact") notes.push("non-compact flange/web: F3 applies, not covered");
    }
    const defl = hasService ? deflFor(I) : undefined;
    const deflLimit = Lmm / defLim;
    const deflOk = defl === undefined || defl <= deflLimit;
    const okClass = code === "IS800" ? sectionClass !== "slender" : sectionClass === "compact";
    return { section: s.name, source: s.source, mass: s.mass, sectionClass, momentCapacity: Mcap / 1e6, utilization: Mu / (Mcap / 1e6), shearCapacity: Vcap / 1e3, shearUtilization: Vu / (Vcap / 1e3), deflection: defl, deflectionLimit: deflLimit, deflectionOk: deflOk, ltb, notes, ok: Mcap / 1e6 >= Mu && deflOk && Vcap / 1e3 >= Vu && okClass };
  });
  const ok = candidates.filter((c) => c.ok).sort((a, b) => a.mass - b.mass);
  return {
    code, fy, support: cant ? "cantilever" : "simply_supported", Mu, Vu,
    ZpRequired: code === "IS800" ? (Mu * 1e6 * 1.1) / fy / 1e3 : (Mu * 1e6) / (0.9 * fy) / 1e3, // cm³, before any LTB reduction
    recommended: ok[0],
    candidates: inp.section ? candidates : ok.slice(0, 5),
    notes: [
      restrained ? "Compression flange assumed continuously restrained (no lateral-torsional buckling). Give unbracedLength if it is not." : `Laterally unsupported length ${(Lb / 1000).toFixed(2)} m, moment factor ${cmf} (${code === "IS800" ? "c1, IS 800 Annex E" : "Cb, AISC F1"}).`,
      code === "IS800" ? "IS 800:2007: Md = βb·Zp·fy/γm0 ≤ 1.2·Ze·fy/γm0 (1.5 for cantilevers), LTB per cl. 8.2.2 / Annex E, shear Vd = h·tw·fy/(√3·γm0), high shear cl. 9.2.2; sections from IS 808:2021." : "AISC 360-16: φMn per F2 (φ = 0.9), shear G2 (φv = 1.0 for rolled I-shapes meeting G2.1(a)); sections from the AISC Shapes Database v15.",
      hasService ? `Deflection limit span/${defLim} under service load.` : "Give serviceUDL / servicePointLoad to check deflection.",
    ],
  };
}
