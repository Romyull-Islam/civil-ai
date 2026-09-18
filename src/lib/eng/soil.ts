/** Terzaghi bearing capacity (general shear) and simple settlement/earth-pressure helpers. */

export interface BearingInput {
  cohesion: number; // kPa
  frictionAngle: number; // degrees
  unitWeight: number; // kN/m³
  depth: number; // m founding depth
  width: number; // m (B)
  length?: number; // m (L) for rectangular; omit for strip
  shape?: "strip" | "square" | "circular" | "rectangular";
  waterTableDepth?: number; // m below ground; default deep
  factorOfSafety?: number; // default 3
}

export function terzaghiFactors(phiDeg: number) {
  const phi = (phiDeg * Math.PI) / 180;
  if (phiDeg === 0) return { Nc: 5.7, Nq: 1.0, Ng: 0.0 };
  const a = Math.exp((0.75 * Math.PI - phi / 2) * Math.tan(phi));
  const Nq = (a * a) / (2 * Math.cos(Math.PI / 4 + phi / 2) ** 2);
  const Nc = (Nq - 1) / Math.tan(phi);
  const Kp = 3 * Math.tan(Math.PI / 4 + (phi + (33 * Math.PI) / 180) / 2) ** 2; // Kpγ approximation
  const Ng = (Math.tan(phi) / 2) * (Kp / Math.cos(phi) ** 2 - 1);
  return { Nc, Nq, Ng };
}

export function bearingCapacity(inp: BearingInput) {
  const { cohesion: c, frictionAngle: phi, unitWeight: g, depth: Df, width: B } = inp;
  const FS = inp.factorOfSafety ?? 3;
  const shape = inp.shape ?? (inp.length ? "rectangular" : "strip");
  const { Nc, Nq, Ng } = terzaghiFactors(phi);
  let sc = 1, sg = 1;
  if (shape === "square") { sc = 1.3; sg = 0.8; }
  else if (shape === "circular") { sc = 1.3; sg = 0.6; }
  else if (shape === "rectangular" && inp.length) { const r = B / inp.length; sc = 1 + 0.3 * r; sg = 1 - 0.2 * r; }
  // water table correction
  let gEff = g;
  let qEff = g * Df;
  const wt = inp.waterTableDepth;
  const gw = 9.81;
  const notes: string[] = [];
  if (wt !== undefined) {
    if (wt <= Df) { qEff = g * wt + (g - gw) * (Df - wt); gEff = g - gw; notes.push("Water table above founding level: submerged unit weight used for q and γ terms."); }
    else if (wt < Df + B) { gEff = (g - gw) + ((g - (g - gw)) * (wt - Df)) / B; notes.push("Water table within B below footing: γ term partially reduced."); }
  }
  const qu = c * Nc * sc + qEff * Nq + 0.5 * gEff * B * Ng * sg;
  const qnu = qu - g * Df;
  const qsafe = qnu / FS + g * Df;
  return {
    factors: { Nc, Nq, Ng },
    shapeFactors: { sc, sq: 1, sg },
    ultimate: qu,
    netUltimate: qnu,
    safe: qsafe,
    netSafe: qnu / FS,
    factorOfSafety: FS,
    notes,
    steps: [
      `Terzaghi factors for φ = ${phi}°: Nc = ${Nc.toFixed(2)}, Nq = ${Nq.toFixed(2)}, Nγ = ${Ng.toFixed(2)}`,
      `qu = c·Nc·sc + q·Nq + 0.5·γ·B·Nγ·sγ = ${(c * Nc * sc).toFixed(1)} + ${(qEff * Nq).toFixed(1)} + ${(0.5 * gEff * B * Ng * sg).toFixed(1)} = ${qu.toFixed(1)} kPa`,
      `Net ultimate qnu = qu − γ·Df = ${qnu.toFixed(1)} kPa; safe bearing capacity = qnu/FS + γ·Df = ${qsafe.toFixed(1)} kPa (FS = ${FS})`,
    ],
  };
}

/** Rankine active/passive earth pressure coefficients and resultant on a vertical wall. */
export function earthPressure(phiDeg: number, height: number, unitWeight: number, surcharge = 0, cohesion = 0) {
  const phi = (phiDeg * Math.PI) / 180;
  const Ka = Math.tan(Math.PI / 4 - phi / 2) ** 2;
  const Kp = Math.tan(Math.PI / 4 + phi / 2) ** 2;
  const Pa = 0.5 * Ka * unitWeight * height * height + Ka * surcharge * height - 2 * cohesion * Math.sqrt(Ka) * height;
  const Pp = 0.5 * Kp * unitWeight * height * height + 2 * cohesion * Math.sqrt(Kp) * height;
  return { Ka, Kp, activeForce: Pa, passiveForce: Pp, activeArm: height / 3, note: "Rankine theory, vertical smooth wall, horizontal backfill." };
}
