/**
 * Shallow foundations and earth pressure.
 *  - Bearing capacity: Terzaghi (general / local shear) and the IS 6403:1981 general equation (shape, depth,
 *    inclination and water-table factors).
 *  - Settlement: primary consolidation of clay (normally or over-consolidated, 2:1 stress spread) and allowable
 *    pressure on sand from SPT N60 for a target settlement (Meyerhof as modified by Bowles).
 *  - Rankine active/passive pressure with surcharge, cohesion (tension crack) and a water table.
 * Units: m, kN, kPa (kN/m²), degrees.
 *
 * Allowable settlement for isolated footings: BNBC 2020 Part 6 Sec 3.9.4.7(d): 25 mm on sand, 40 mm on clay.
 * Factor of safety on bearing capacity: BNBC 2020 Sec 3.9.3: 2.0–3.0 (3.0 used by default).
 */

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Terzaghi's Nγ as tabulated by Das (Principles of Foundation Engineering, Table 3.1, after Kumbhojkar 1993).
 * Per degree 20–40°, every 5° elsewhere; log-linear interpolation in between.
 */
const NG_TABLE: [number, number][] = [
  [0, 0], [5, 0.14], [10, 0.56], [15, 1.52], [20, 3.64], [21, 4.31], [22, 5.09], [23, 6.0], [24, 7.08], [25, 8.34],
  [26, 9.84], [27, 11.6], [28, 13.7], [29, 16.18], [30, 19.13], [31, 22.65], [32, 26.87], [33, 31.94], [34, 38.04], [35, 45.41],
  [36, 54.36], [37, 65.27], [38, 78.61], [39, 95.03], [40, 115.31], [45, 326.73], [50, 1072.8],
];
function terzaghiNgamma(phi: number): number {
  if (phi <= 0) return 0;
  for (let i = 0; i < NG_TABLE.length - 1; i++) {
    const [p0, n0] = NG_TABLE[i], [p1, n1] = NG_TABLE[i + 1];
    if (phi >= p0 && phi <= p1) {
      const t = (phi - p0) / (p1 - p0);
      return n0 <= 0 ? n1 * t : Math.exp(Math.log(n0) + t * (Math.log(n1) - Math.log(n0)));
    }
  }
  return NG_TABLE[NG_TABLE.length - 1][1];
}

/** Terzaghi bearing capacity factors: Nq and Nc from Terzaghi's closed form, Nγ from the Kumbhojkar table. */
export function terzaghiFactors(phiDeg: number) {
  if (phiDeg === 0) return { Nc: 5.7, Nq: 1.0, Ng: 0.0 };
  const phi = rad(phiDeg);
  const a = Math.exp((0.75 * Math.PI - phi / 2) * Math.tan(phi));
  const Nq = (a * a) / (2 * Math.cos(Math.PI / 4 + phi / 2) ** 2);
  const Nc = (Nq - 1) / Math.tan(phi);
  return { Nc, Nq, Ng: terzaghiNgamma(phiDeg) };
}

/** IS 6403 Table 1 (Vesic) factors: Nq = e^(π tanφ)·tan²(45° + φ/2), Nc = (Nq − 1)·cotφ, Nγ = 2(Nq + 1)·tanφ. */
export function is6403Factors(phiDeg: number) {
  if (phiDeg === 0) return { Nc: 5.14, Nq: 1.0, Ng: 0.0 };
  const phi = rad(phiDeg);
  const Nq = Math.exp(Math.PI * Math.tan(phi)) * Math.tan(Math.PI / 4 + phi / 2) ** 2;
  return { Nc: (Nq - 1) / Math.tan(phi), Nq, Ng: 2 * (Nq + 1) * Math.tan(phi) };
}

export interface BearingInput {
  cohesion: number; // kPa
  frictionAngle: number; // degrees
  unitWeight: number; // kN/m³ (bulk, above the water table)
  saturatedUnitWeight?: number; // kN/m³ below the water table (default = unitWeight)
  depth: number; // m founding depth Df
  width: number; // m (B)
  length?: number; // m (L) for rectangular
  shape?: "strip" | "square" | "circular" | "rectangular";
  waterTableDepth?: number; // m below ground (default: deep)
  factorOfSafety?: number; // default 3 (BNBC 3.9.3 allows 2.0–3.0)
  method?: "terzaghi" | "is6403";
  shearMode?: "general" | "local"; // local shear for loose sand / soft clay (c' = 2c/3, tanφ' = 2tanφ/3)
  loadInclination?: number; // degrees from vertical (IS 6403 only)
}

export function bearingCapacity(inp: BearingInput) {
  const method = inp.method ?? "terzaghi";
  const local = inp.shearMode === "local";
  const c = local ? (2 / 3) * inp.cohesion : inp.cohesion;
  const phi = local ? (Math.atan((2 / 3) * Math.tan(rad(inp.frictionAngle))) * 180) / Math.PI : inp.frictionAngle;
  const g = inp.unitWeight;
  const gsat = inp.saturatedUnitWeight ?? g;
  const gw = 9.81;
  const { depth: Df, width: B } = inp;
  const FS = inp.factorOfSafety ?? 3;
  const shape = inp.shape ?? (inp.length ? "rectangular" : "strip");
  const r = shape === "rectangular" && inp.length ? B / inp.length : shape === "strip" ? 0 : 1;
  const notes: string[] = [];
  if (local) notes.push(`Local shear: c' = ${c.toFixed(1)} kPa, φ' = ${phi.toFixed(1)}° (2/3 rule).`);

  // effective overburden at founding level and the unit weight in the γ term (water table)
  const wt = inp.waterTableDepth;
  let q = g * Df, gEff = g, wFactor = 1;
  if (wt !== undefined) {
    if (wt <= Df) {
      q = g * wt + (gsat - gw) * (Df - wt); gEff = gsat - gw; wFactor = 0.5;
      notes.push("Water table at or above founding level: effective unit weights used.");
    } else if (wt < Df + B) {
      const dw = wt - Df;
      gEff = gsat - gw + (dw / B) * (g - (gsat - gw)); wFactor = 0.5 + (0.5 * dw) / B;
      notes.push("Water table within B below the footing: γ term reduced.");
    }
  }

  if (method === "terzaghi") {
    const { Nc, Nq, Ng } = terzaghiFactors(phi);
    const [sc, sg] = shape === "square" ? [1.3, 0.8] : shape === "circular" ? [1.3, 0.6] : shape === "rectangular" ? [1 + 0.3 * r, 1 - 0.2 * r] : [1, 1];
    const qu = c * Nc * sc + q * Nq + 0.5 * gEff * B * Ng * sg;
    const qnu = qu - q;
    return {
      method: "Terzaghi", factors: { Nc, Nq, Ng }, shapeFactors: { sc, sq: 1, sg }, ultimate: qu, netUltimate: qnu, safe: qnu / FS + q, netSafe: qnu / FS, factorOfSafety: FS, notes,
      steps: [
        `Terzaghi (${local ? "local" : "general"} shear), φ = ${phi.toFixed(1)}°: Nc = ${Nc.toFixed(2)}, Nq = ${Nq.toFixed(2)}, Nγ = ${Ng.toFixed(2)} (Nγ after Kumbhojkar, as tabulated by Das)`,
        `qu = c·Nc·sc + q·Nq + 0.5·γ·B·Nγ·sγ = ${(c * Nc * sc).toFixed(1)} + ${(q * Nq).toFixed(1)} + ${(0.5 * gEff * B * Ng * sg).toFixed(1)} = ${qu.toFixed(1)} kPa (q = ${q.toFixed(1)} kPa)`,
        `Net ultimate = qu − q = ${qnu.toFixed(1)} kPa; net safe = ${(qnu / FS).toFixed(1)} kPa; gross safe = ${(qnu / FS + q).toFixed(1)} kPa (FS = ${FS})`,
      ],
    };
  }
  // IS 6403:1981 cl. 5.1.2 general equation (net ultimate)
  const { Nc, Nq, Ng } = is6403Factors(phi);
  const [sc, sq, sg] = shape === "strip" ? [1, 1, 1] : shape === "square" ? [1.3, 1.2, 0.8] : shape === "circular" ? [1.3, 1.2, 0.6] : [1 + 0.2 * r, 1 + 0.2 * r, 1 - 0.4 * r];
  const Nphi = Math.tan(Math.PI / 4 + rad(phi) / 2) ** 2;
  const dc = 1 + 0.2 * (Df / B) * Math.sqrt(Nphi);
  const dq = phi < 10 ? 1 : 1 + 0.1 * (Df / B) * Math.sqrt(Nphi);
  const alpha = inp.loadInclination ?? 0;
  const ic = (1 - alpha / 90) ** 2, iq = ic, ig = phi > 0 ? Math.max(0, 1 - alpha / phi) ** 2 : 0;
  const gTerm = 0.5 * g * B * Ng * sg * dq * ig * wFactor; // IS uses γ with the W' factor
  const qnu = c * Nc * sc * dc * ic + q * (Nq - 1) * sq * dq * iq + gTerm;
  return {
    method: "IS 6403", factors: { Nc, Nq, Ng }, shapeFactors: { sc, sq, sg }, depthFactors: { dc, dq, dg: dq }, inclinationFactors: { ic, iq, ig }, waterFactor: wFactor,
    ultimate: qnu + q, netUltimate: qnu, safe: qnu / FS + q, netSafe: qnu / FS, factorOfSafety: FS, notes,
    steps: [
      `IS 6403 (${local ? "local" : "general"} shear), φ = ${phi.toFixed(1)}°: Nc = ${Nc.toFixed(2)}, Nq = ${Nq.toFixed(2)}, Nγ = ${Ng.toFixed(2)}; shape sc ${sc.toFixed(2)}, sq ${sq.toFixed(2)}, sγ ${sg.toFixed(2)}; depth dc ${dc.toFixed(3)}, dq = dγ ${dq.toFixed(3)}${alpha ? `; inclination ic = iq ${ic.toFixed(3)}, iγ ${ig.toFixed(3)}` : ""}; W' = ${wFactor.toFixed(3)}`,
      `qnu = c·Nc·sc·dc·ic + q·(Nq − 1)·sq·dq·iq + 0.5·γ·B·Nγ·sγ·dγ·iγ·W' = ${qnu.toFixed(1)} kPa (q = ${q.toFixed(1)} kPa)`,
      `Net safe = ${(qnu / FS).toFixed(1)} kPa; gross safe = ${(qnu / FS + q).toFixed(1)} kPa (FS = ${FS})`,
    ],
  };
}

// ---------------- Settlement ----------------

/** Vertical stress increase below a B×L footing at depth z below its base, 2:1 method (kPa). */
export const stress21 = (qNet: number, B: number, L: number, z: number) => (qNet * B * L) / ((B + z) * (L + z));

export interface ClayLayer {
  thickness: number; // m
  e0: number;
  Cc: number;
  Cr?: number; // recompression index (default Cc/5)
  sigma0: number; // effective overburden at mid-layer, kPa
  deltaSigma: number; // stress increase at mid-layer, kPa
  sigmaP?: number; // preconsolidation pressure, kPa (default = sigma0, normally consolidated)
}

/** Primary consolidation settlement (mm) of one clay layer, normally or over-consolidated. */
export function consolidationSettlement(l: ClayLayer): { settlement: number; case: string } {
  const H = l.thickness * 1000;
  const s0 = l.sigma0, sf = l.sigma0 + l.deltaSigma;
  const sp = Math.max(l.sigmaP ?? s0, s0);
  const Cr = l.Cr ?? l.Cc / 5;
  if (sp <= s0 + 1e-9) return { settlement: ((l.Cc * H) / (1 + l.e0)) * Math.log10(sf / s0), case: "normally consolidated" };
  if (sf <= sp) return { settlement: ((Cr * H) / (1 + l.e0)) * Math.log10(sf / s0), case: "over-consolidated, stays below σ'p" };
  return { settlement: ((Cr * H) / (1 + l.e0)) * Math.log10(sp / s0) + ((l.Cc * H) / (1 + l.e0)) * Math.log10(sf / sp), case: "over-consolidated, passes σ'p" };
}

/**
 * Net allowable pressure on sand for a target settlement from SPT N60 (Meyerhof, as modified by Bowles 1977):
 * B ≤ 1.2 m: q = N/0.05·Fd·(S/25); B > 1.2 m: q = N/0.08·((B + 0.3)/B)²·Fd·(S/25); Fd = 1 + 0.33·Df/B ≤ 1.33. kPa.
 */
export function sptAllowablePressure(N60: number, B: number, Df: number, settlementMm = 25): number {
  const Fd = Math.min(1.33, 1 + (0.33 * Df) / B);
  const base = B <= 1.2 ? N60 / 0.05 : (N60 / 0.08) * ((B + 0.3) / B) ** 2;
  return base * Fd * (settlementMm / 25);
}

// ---------------- Earth pressure ----------------

export interface EarthPressureInput {
  frictionAngle: number; // degrees
  height: number; // m
  unitWeight: number; // kN/m³ above the water table
  saturatedUnitWeight?: number; // below the water table (default = unitWeight)
  surcharge?: number; // kPa
  cohesion?: number; // kPa
  waterTableDepth?: number; // m below the top of the wall (default: none)
}

/**
 * Rankine pressure on a smooth vertical wall with horizontal backfill. Active pressure p = Ka(σ'v + q) − 2c√Ka (tension
 * ignored, i.e. a tension crack) plus water pressure; resultant and its height above the base by integration.
 */
export function earthPressure(phiDeg: number, height: number, unitWeight: number, surcharge = 0, cohesion = 0, opts: { saturatedUnitWeight?: number; waterTableDepth?: number } = {}) {
  const phi = rad(phiDeg);
  const Ka = Math.tan(Math.PI / 4 - phi / 2) ** 2;
  const Kp = Math.tan(Math.PI / 4 + phi / 2) ** 2;
  const gsat = opts.saturatedUnitWeight ?? unitWeight;
  const zw = opts.waterTableDepth ?? Number.POSITIVE_INFINITY;
  const gw = 9.81;
  const sv = (z: number) => (z <= zw ? unitWeight * z : unitWeight * zw + (gsat - gw) * (z - zw));
  const u = (z: number) => (z > zw ? gw * (z - zw) : 0);
  const n = 2000;
  let Pa = 0, MaBase = 0, Pp = 0, MpBase = 0, zc = 0;
  for (let i = 0; i < n; i++) {
    const z = ((i + 0.5) * height) / n, dz = height / n;
    const pa = Math.max(0, Ka * (sv(z) + surcharge) - 2 * cohesion * Math.sqrt(Ka)) + u(z);
    const pp = Kp * sv(z) + 2 * cohesion * Math.sqrt(Kp) + u(z);
    if (pa === u(z) && pa === 0) zc = z + dz / 2;
    Pa += pa * dz; MaBase += pa * dz * (height - z);
    Pp += pp * dz; MpBase += pp * dz * (height - z);
  }
  return {
    Ka, Kp,
    activeForce: Pa, activeArm: Pa > 0 ? MaBase / Pa : 0,
    passiveForce: Pp, passiveArm: Pp > 0 ? MpBase / Pp : 0,
    tensionCrackDepth: cohesion > 0 ? Math.min(height, zc) : 0,
    note: "Rankine: smooth vertical wall, horizontal backfill; tension in cohesive soil ignored (tension crack, not filled with water)." + (Number.isFinite(zw) ? " Effective stresses below the water table plus hydrostatic water pressure." : ""),
  };
}
