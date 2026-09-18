/**
 * Structural steel: small section database and bending/deflection checks.
 * IS 800:2007 (LSM, γm0 = 1.10) and AISC 360 (LRFD φb = 0.90).
 * Section properties: mass kg/m, depth h mm, width b mm, Ix cm⁴, Zx (elastic) cm³, Zpx (plastic) cm³.
 */

export interface SteelSection { name: string; mass: number; h: number; b: number; tw: number; tf: number; Ix: number; Zx: number; Zpx: number }

export const SECTIONS: SteelSection[] = [
  // Indian standard medium beams (IS 808)
  { name: "ISMB 100", mass: 11.5, h: 100, b: 75, tw: 4.0, tf: 7.2, Ix: 257.5, Zx: 51.5, Zpx: 60.0 },
  { name: "ISMB 125", mass: 13.0, h: 125, b: 75, tw: 4.4, tf: 7.6, Ix: 449.0, Zx: 71.8, Zpx: 82.0 },
  { name: "ISMB 150", mass: 14.9, h: 150, b: 80, tw: 4.8, tf: 7.6, Ix: 726.4, Zx: 96.9, Zpx: 110.5 },
  { name: "ISMB 175", mass: 19.3, h: 175, b: 90, tw: 5.5, tf: 8.6, Ix: 1272.0, Zx: 145.4, Zpx: 166.1 },
  { name: "ISMB 200", mass: 25.4, h: 200, b: 100, tw: 5.7, tf: 10.8, Ix: 2235.4, Zx: 223.5, Zpx: 253.9 },
  { name: "ISMB 250", mass: 37.3, h: 250, b: 125, tw: 6.9, tf: 12.5, Ix: 5131.6, Zx: 410.5, Zpx: 465.7 },
  { name: "ISMB 300", mass: 44.2, h: 300, b: 140, tw: 7.5, tf: 12.4, Ix: 8603.6, Zx: 573.6, Zpx: 651.7 },
  { name: "ISMB 350", mass: 52.4, h: 350, b: 140, tw: 8.1, tf: 14.2, Ix: 13630.3, Zx: 778.9, Zpx: 889.6 },
  { name: "ISMB 400", mass: 61.6, h: 400, b: 140, tw: 8.9, tf: 16.0, Ix: 20458.4, Zx: 1022.9, Zpx: 1176.2 },
  { name: "ISMB 450", mass: 72.4, h: 450, b: 150, tw: 9.4, tf: 17.4, Ix: 30390.8, Zx: 1350.7, Zpx: 1553.4 },
  { name: "ISMB 500", mass: 86.9, h: 500, b: 180, tw: 10.2, tf: 17.2, Ix: 45218.3, Zx: 1808.7, Zpx: 2074.8 },
  { name: "ISMB 550", mass: 103.7, h: 550, b: 190, tw: 11.2, tf: 19.3, Ix: 64893.6, Zx: 2359.8, Zpx: 2711.9 },
  { name: "ISMB 600", mass: 122.6, h: 600, b: 210, tw: 12.0, tf: 20.8, Ix: 91813.0, Zx: 3060.4, Zpx: 3510.6 },
  // AISC W-shapes (metric-ish properties converted)
  { name: "W8x18", mass: 26.8, h: 207, b: 133, tw: 5.8, tf: 8.4, Ix: 2580, Zx: 250, Zpx: 279 },
  { name: "W10x22", mass: 32.7, h: 258, b: 146, tw: 6.1, tf: 9.1, Ix: 4910, Zx: 381, Zpx: 426 },
  { name: "W12x26", mass: 38.7, h: 310, b: 165, tw: 5.8, tf: 9.7, Ix: 8490, Zx: 548, Zpx: 611 },
  { name: "W14x30", mass: 44.6, h: 352, b: 171, tw: 6.9, tf: 9.8, Ix: 12100, Zx: 688, Zpx: 774 },
  { name: "W16x36", mass: 53.6, h: 403, b: 177, tw: 7.5, tf: 10.9, Ix: 18700, Zx: 928, Zpx: 1050 },
  { name: "W18x50", mass: 74.4, h: 457, b: 190, tw: 9.0, tf: 14.5, Ix: 33300, Zx: 1460, Zpx: 1650 },
  { name: "W21x62", mass: 92.3, h: 533, b: 209, tw: 10.2, tf: 15.6, Ix: 55400, Zx: 2080, Zpx: 2360 },
  { name: "W24x76", mass: 113.0, h: 608, b: 228, tw: 11.2, tf: 17.3, Ix: 87400, Zx: 2870, Zpx: 3280 },
];

export interface SteelBeamInput {
  code?: "IS800" | "AISC";
  span: number; // m
  support?: "simply_supported" | "cantilever";
  /** factored uniformly distributed load kN/m (incl. self weight allowance) */
  factoredUDL?: number;
  /** factored point load kN at midspan (simply supported) or at the tip (cantilever) */
  factoredPointLoad?: number;
  /** service (unfactored) loads for the deflection check */
  serviceUDL?: number;
  servicePointLoad?: number;
  factoredMoment?: number; // kN·m, overrides loads
  fy?: number; // MPa default 250 (IS) / 345 (AISC A992)
  section?: string; // check a specific section
  deflectionLimit?: number; // span/L (default 300 SS / 150 cantilever)
  lateralSupport?: boolean; // default true (full lateral restraint)
}

export function findSection(name: string): SteelSection | undefined {
  const n = name.toLowerCase().replace(/\s+/g, "");
  return SECTIONS.find((s) => s.name.toLowerCase().replace(/\s+/g, "") === n);
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
  const E = 200000;
  const ZpReq = code === "IS800" ? (Mu * 1e6 * 1.1) / fy : (Mu * 1e6) / (0.9 * fy); // mm³
  const ws = inp.serviceUDL;
  const Ps = inp.servicePointLoad;
  const hasService = ws !== undefined || Ps !== undefined;
  const Lmm = L * 1000;
  // deflection in mm for I in mm⁴; loads: w kN/m = N/mm, P kN = 1000 N
  const deflFor = (I: number) => cant ? ((ws ?? 0) * Lmm ** 4) / (8 * E * I) + ((Ps ?? 0) * 1e3 * Lmm ** 3) / (3 * E * I) : (5 * (ws ?? 0) * Lmm ** 4) / (384 * E * I) + ((Ps ?? 0) * 1e3 * Lmm ** 3) / (48 * E * I);
  const candidates = SECTIONS.filter((s) => (inp.section ? findSection(inp.section)?.name === s.name : true)).map((s) => {
    const Zp = s.Zpx * 1e3; // mm³
    const Mcap = code === "IS800" ? Math.min((Zp * fy) / 1.1, (1.2 * s.Zx * 1e3 * fy) / 1.1) / 1e6 : (0.9 * Zp * fy) / 1e6;
    const I = s.Ix * 1e4;
    const defl = hasService ? deflFor(I) : undefined;
    const deflLimit = Lmm / defLim;
    const deflOk = defl === undefined || defl <= deflLimit;
    // web shear capacity: Vd = Av·fy/(√3·γm0) with Av = h·tw (IS 800 cl. 8.4) / φ·0.6·Fy·Aw (AISC G2)
    const Av = s.h * s.tw;
    const Vcap = code === "IS800" ? (Av * fy) / (Math.sqrt(3) * 1.1) / 1e3 : (0.9 * 0.6 * fy * Av) / 1e3;
    return { section: s.name, mass: s.mass, momentCapacity: Mcap, utilization: Mu / Mcap, shearCapacity: Vcap, shearUtilization: Vu / Vcap, deflection: defl, deflectionLimit: deflLimit, deflectionOk: deflOk, ok: Mcap >= Mu && deflOk && Vcap >= Vu };
  });
  const ok = candidates.filter((c) => c.ok).sort((a, b) => a.mass - b.mass);
  if (inp.section && !candidates.length) throw new Error(`Unknown section "${inp.section}". Known: ${SECTIONS.map((s) => s.name).join(", ")}`);
  return {
    code,
    fy,
    support: cant ? "cantilever" : "simply_supported",
    Mu,
    Vu,
    ZpRequired: ZpReq / 1e3, // cm³
    recommended: ok[0],
    candidates: inp.section ? candidates : ok.slice(0, 5),
    notes: [
      `Assumes full lateral restraint (plastic section, no LTB reduction). ${cant ? "Cantilever fixed at the support, loads at the free end/along the span." : "Simply supported; point load at midspan."} Check LTB if unrestrained.`,
      code === "IS800" ? "IS 800:2007 cl. 8.2.1.2: Md = βb·Zp·fy/γm0 ≤ 1.2·Ze·fy/γm0; shear cl. 8.4: Vd = Av·fy/(√3·γm0)" : "AISC 360 F2: φMn = 0.9·Fy·Zx; shear G2: φVn = 0.9·0.6·Fy·Aw",
      hasService ? `Deflection limit span/${defLim} (${cant ? "cantilever" : "simply supported"}).` : "Provide serviceUDL / servicePointLoad to check deflection.",
    ],
  };
}
