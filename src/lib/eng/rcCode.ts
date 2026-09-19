/**
 * Design-code parameters shared by the reinforced-concrete calculators.
 *
 * BNBC2020  Bangladesh National Building Code 2020, Part 6 Ch. 6 (strength design following the ACI 318 method)
 * ACI318    ACI 318-19 (USA)
 * IS456     IS 456:2000 limit-state method (India), with SP-16 design aids
 *
 * Units: MPa, mm, kN, kN·m. Every value here is referenced to its clause so it can be reviewed in one place.
 */

export type DesignCode = "BNBC2020" | "ACI318" | "IS456";
export const DESIGN_CODES: DesignCode[] = ["BNBC2020", "ACI318", "IS456"];
export const DEFAULT_CODE: DesignCode = "BNBC2020";

export const ES = 200000; // MPa, reinforcing steel modulus (ACI 20.2.2.2, IS 456 cl. 5.6.3)

export interface CodeInfo {
  code: DesignCode;
  label: string;
  family: "ACI" | "IS";
  /** strength load factors for dead and live load (BNBC 2.7.3 / ACI 5.3.1b: 1.2D + 1.6L; IS 456 Table 18: 1.5(D + L)) */
  loadFactors: { dead: number; live: number };
  /** ACI 318-19 introduced the size-effect factor λs and ρw^(1/3) one-way shear; earlier editions (and BNBC 2020) use 0.17√f'c */
  sizeEffectShear: boolean;
  /** tension-controlled strain limit rule: "0.005" (ACI 318-14 / BNBC) or "fy-based" (ACI 318-19: εty + 0.003) */
  tensionControl: "0.005" | "fy-based";
}

export const CODES: Record<DesignCode, CodeInfo> = {
  BNBC2020: { code: "BNBC2020", label: "BNBC 2020 (Bangladesh)", family: "ACI", loadFactors: { dead: 1.2, live: 1.6 }, sizeEffectShear: false, tensionControl: "0.005" },
  ACI318: { code: "ACI318", label: "ACI 318-19 (USA)", family: "ACI", loadFactors: { dead: 1.2, live: 1.6 }, sizeEffectShear: true, tensionControl: "fy-based" },
  IS456: { code: "IS456", label: "IS 456:2000 (India)", family: "IS", loadFactors: { dead: 1.5, live: 1.5 }, sizeEffectShear: false, tensionControl: "0.005" },
};

/** Accept older/loose spellings from saved chats and model output. */
export function normalizeCode(c: string | undefined): DesignCode {
  const s = (c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("IS")) return "IS456";
  if (s.startsWith("ACI")) return "ACI318";
  if (s.startsWith("BNBC") || s === "BD" || s === "") return "BNBC2020";
  return DEFAULT_CODE;
}

// ---------------- ACI-family helpers (BNBC 2020 and ACI 318-19) ----------------

/** β1 for the equivalent rectangular stress block (ACI 22.2.2.4.3). */
export const beta1 = (fc: number) => (fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - (0.05 * (fc - 28)) / 7));

/** Strain limits for φ (ACI 21.2.2): compression-controlled at εty, tension-controlled at 0.005 (318-14/BNBC) or εty + 0.003 (318-19). */
export function strainLimits(code: DesignCode, fy: number): { compression: number; tension: number } {
  const ety = fy / ES;
  return { compression: ety, tension: CODES[code].tensionControl === "fy-based" ? ety + 0.003 : Math.max(0.005, ety + 0.001) };
}

/** φ for flexure/axial of tied members from the net tensile strain εt (ACI Table 21.2.2). */
export function phiTied(code: DesignCode, fy: number, et: number): number {
  const { compression, tension } = strainLimits(code, fy);
  if (et <= compression) return 0.65;
  if (et >= tension) return 0.9;
  return 0.65 + (0.25 * (et - compression)) / (tension - compression);
}

/** Size-effect factor λs = √(2/(1 + 0.004d)) ≤ 1 (ACI 318-19 22.5.5.1.3), d in mm. */
export const lambdaS = (d: number) => Math.min(1, Math.sqrt(2 / (1 + 0.004 * d)));

/** Maximum yield strength usable for shear/transverse reinforcement: 420 MPa (ACI Table 20.2.2.4a), 415 MPa (IS 456 cl. 40.4). */
export const fytMax = (code: DesignCode) => (code === "IS456" ? 415 : 420);

/** Minimum reinforcement for slabs and footings (ratio of gross area): ACI 318-19 Table 7.6.1.1 / 318-14 Table 7.6.1.1; IS 456 cl. 26.5.2.1. */
export function slabMinSteelRatio(code: DesignCode, fy: number): number {
  if (code === "IS456") return fy <= 250 ? 0.0015 : 0.0012;
  if (code === "ACI318") return 0.0018;
  // ACI 318-14 (followed by BNBC 2020): Grade 280/350 → 0.0020, Grade 420 → 0.0018, higher → 0.0018×420/fy ≥ 0.0014
  if (fy < 420) return 0.002;
  return Math.max(0.0014, (0.0018 * 420) / fy);
}

/** Ec = 4700√f'c (ACI 19.2.2.1), 5000√fck (IS 456 cl. 6.2.3.1). */
export const concreteModulus = (code: DesignCode, fc: number) => (code === "IS456" ? 5000 : 4700) * Math.sqrt(fc);

// ---------------- IS 456 helpers ----------------

/**
 * Design stress in reinforcement for a strain (IS 456 Fig. 23 with the SP-16 Table A values): mild steel Fe250 is
 * elastic-perfectly plastic at 0.87fy; cold-worked HYSD bars (Fe415/Fe500/Fe550) follow the inelastic curve defined by
 * the inelastic strain offsets 0, 0.0001, 0.0003, 0.0007, 0.0010, 0.0020 at 0.80, 0.85, 0.90, 0.95, 0.975, 1.0 × 0.87fy.
 */
export function isSteelStress(fy: number, strain: number): number {
  const s = Math.abs(strain);
  const fyd = 0.87 * fy;
  let f: number;
  if (fy <= 250) f = Math.min(ES * s, fyd);
  else {
    const levels = [0.8, 0.85, 0.9, 0.95, 0.975, 1.0];
    const offsets = [0, 0.0001, 0.0003, 0.0007, 0.001, 0.002];
    const pts = levels.map((k, i) => [(k * fyd) / ES + offsets[i], k * fyd] as const);
    if (s <= pts[0][0]) f = ES * s;
    else if (s >= pts[pts.length - 1][0]) f = fyd;
    else {
      let i = 0;
      while (s > pts[i + 1][0]) i++;
      const [e0, f0] = pts[i]; const [e1, f1] = pts[i + 1];
      f = f0 + ((f1 - f0) * (s - e0)) / (e1 - e0);
    }
  }
  return Math.sign(strain) * f;
}

/** IS 456 design stress block for concrete: parabola to 0.002, then constant 0.446fck (= 0.67fck/1.5) to 0.0035 (cl. 38.1, Fig. 21). */
export function isConcreteStress(fck: number, strain: number): number {
  if (strain <= 0) return 0;
  const fcd = (0.67 * fck) / 1.5;
  if (strain >= 0.002) return fcd;
  const r = strain / 0.002;
  return fcd * (2 * r - r * r);
}

/** IS 456 Table 19 τc (closed form from SP-24 Explanatory Handbook, matches the table within rounding). */
export function tauC_IS(fck: number, pt: number): number {
  const p = Math.max(0.15, Math.min(3, pt));
  const f = Math.min(fck, 40); // Table 19 does not increase beyond M40
  const beta = Math.max(1, (0.8 * f) / (6.89 * p));
  return (0.85 * Math.sqrt(0.8 * f) * (Math.sqrt(1 + 5 * beta) - 1)) / (6 * beta);
}

/** IS 456 Table 20 τc,max. */
export function tauCmax_IS(fck: number): number {
  const table: [number, number][] = [[15, 2.5], [20, 2.8], [25, 3.1], [30, 3.5], [35, 3.7], [40, 4.0]];
  for (const [f, t] of table) if (fck <= f) return t;
  return 4.0;
}

/** IS 456 cl. 40.2.1.1: factor k for solid slabs (1.30 at ≤150 mm down to 1.00 at ≥300 mm). */
export const slabShearK_IS = (D: number) => (D <= 150 ? 1.3 : D >= 300 ? 1.0 : 1.3 - (0.3 * (D - 150)) / 150);

/** IS 456 cl. 26.2.1.1 design bond stress for deformed bars in tension (Table in 26.2.1.1 × 1.6). */
export function tauBd_IS(fck: number): number {
  const table: [number, number][] = [[20, 1.2], [25, 1.4], [30, 1.5], [35, 1.7], [40, 1.9]];
  let t = 1.9;
  for (const [f, v] of table) if (fck <= f) { t = v; break; }
  return t * 1.6;
}
