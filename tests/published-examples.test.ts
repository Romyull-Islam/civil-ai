/**
 * Calculators checked against PUBLISHED worked examples (inputs and answers as printed in the source).
 * Each block names its source. Tolerances reflect rounding in the source, chart reading, or SI vs US constants
 * (e.g. ACI's 0.17√f'c in SI vs 2√f'c in psi differ by 2%). Where our method legitimately differs (e.g. a chart read
 * by eye), the tolerance says so.
 */
import { describe, it, expect } from "vitest";
import { designRcBeam, designIsolatedFooting, tauC_IS } from "@/lib/eng/rc";
import { designColumn, sectionResponse, perimeterBars, interactionCurve, momentCapacityAt, barArea, type RectSection } from "@/lib/eng/column";
import { phiTied, lambdaS } from "@/lib/eng/rcCode";
import { bearingCapacity, is6403Factors, terzaghiFactors, consolidationSettlement, sptAllowablePressure, stress21, earthPressure } from "@/lib/eng/soil";
import { aiscF2, findSection, mcrIS800, isLTB } from "@/lib/eng/steel";

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(rel);
const IN = 25.4, KIP = 4.448222, KFT = 1.355818, KSI = 6.894757;

describe("ACI 318 tied column interaction (StructurePoint, Wight Ex. 11-1: 16×16 in, 8 #9, f'c 5000 psi, fy 60 ksi)", () => {
  const h = 16 * IN, A = 645.16; // #9 = 1.00 in²
  const sec: RectSection = { b: h, h, bars: [...[1, 2, 3, 4].map((i) => ({ x: (i * h) / 5, y: 2.5 * IN, area: A })), ...[1, 2, 3, 4].map((i) => ({ x: (i * h) / 5, y: 13.5 * IN, area: A }))] };
  const fc = 5 * KSI, fy = 60 * KSI;
  // source: https://structurepoint.org/publication/pdf/Interaction-Diagram-Tied-Reinforced-Concrete-Column-Design-Strength-ACI-318-19.pdf
  const points: [number, number, number][] = [[13.5, 957.4, 261.33], [10.04, 649.1, 338.54], [7.99, 416.8, 385.81], [5.02, 190.7, 318.61]];
  it("nominal Pn and Mn at the published neutral-axis depths", () => {
    for (const [c, Pn, Mn] of points) {
      const r = sectionResponse("ACI318", sec, fc, fy, "x", c * IN);
      close(r.P / 1e3, Pn * KIP, 0.012); // β1 0.8038 (SI formula) vs 0.80 (psi) and Es 200 000 vs 29 000 ksi
      close(r.M / 1e6, Mn * KFT, 0.012);
    }
  });
  it("φ = 0.90 at εt = εy + 0.003 (ACI 318-19) and 0.65 at the balanced point", () => {
    const r = sectionResponse("ACI318", sec, fc, fy, "x", 5.02 * IN);
    expect(phiTied("ACI318", fy, r.et)).toBeCloseTo(0.9, 2);
    const b = sectionResponse("ACI318", sec, fc, fy, "x", 7.99 * IN);
    expect(phiTied("ACI318", fy, b.et)).toBeCloseTo(0.65, 2);
  });
  it("φPn,max = 797.7 kips and pure bending φMn = 213.96 kip-ft", () => {
    const curve = interactionCurve("ACI318", sec, fc, fy, "x");
    close(Math.max(...curve.map((p) => p.P)), 797.7 * KIP, 0.01);
    close(momentCapacityAt(curve, 0), 213.96 * KFT, 0.012);
  });
});

describe("ACI non-sway slender column (PCA Notes Ex. 11.1 via ASDIP, ACI 318-08/11 equations = BNBC 2020)", () => {
  // 24×24 in, 16 #7, f'c 6000 psi, k = 1, lu = 21.33 ft, Pu = 1603.5 k, M1 = 3.3, M2 = 13.4 k-ft single curvature, βdns = 0.95
  // published: klu/r 35.6 > 31.02, Cm 0.70, EI 21.73e6 kip-in², Pc 3274 k, δns 2.02, M2,min 176.4 k-ft governs, Mc 356.3 k-ft
  it("moment magnification", () => {
    const r = designColumn({ code: "BNBC2020", b: 24 * IN, h: 24 * IN, fc: 6 * KSI, fy: 60 * KSI, Pu: 1603.5 * KIP, Mux: 13.4 * KFT, lu: 21.33 * 12 * IN, endMomentRatio: 3.3 / 13.4, curvature: "single", sustainedRatio: 0.95, clearCover: 1.5 * IN, tieDia: 0.375 * IN, bars: { count: 16, dia: 0.875 * IN } });
    const s = r.steps.join(" ");
    expect(s).toMatch(/slender \(k·lu\/r = 35\.\d > 31\.0\)/);
    expect(s).toMatch(/Pc = 145\d\d kN/); // 3264 k vs 3274 k published
    expect(s).toMatch(/δns = 2\.0[23]/);
    expect(s).toMatch(/Cm = 0\.70/);
    close(r.designMoments.x, 356.3 * KFT, 0.01); // M2,min uses 15 mm (SI) vs 0.6 in = 15.24 mm (US)
  });
});

describe("ACI footing shear formulas (StructurePoint square footing, Wight Ex. 15-2, ACI 318-14 = BNBC 2020)", () => {
  // f'c = 3000 psi, d = 28 in, b0 = 184 in, square column: φvc candidates 164, 246, 332 psi; one-way φVc = 308 k (B = 134 in)
  it("two-way φvc per the three BNBC/ACI 318-14 expressions", () => {
    const rt = Math.sqrt(3 * KSI), d = 28 * IN, bo = 184 * IN;
    const cands = [0.33 * rt, 0.17 * (1 + 2 / 1) * rt, 0.083 * (2 + (40 * d) / bo) * rt].map((v) => (0.75 * v * 1e3) / KSI); // psi
    // the SI code constants (0.33, 0.17, 0.083 in BNBC and ACI 318M) are rounded from 4, 2 and 1 √psi: up to 2.4% apart
    close(cands[0], 164, 0.01); close(cands[1], 246, 0.03); close(cands[2], 332, 0.01);
  });
  it("ACI 318-19 size-effect factor λs (StructurePoint retaining wall, d = 13.5 in → 0.92)", () => { close(lambdaS(13.5 * IN), 0.92, 0.005); });
});

describe("IS 456 beams (NPTEL IIT Kharagpur, Version 2 CE, Modules 3–6)", () => {
  // Design Problem 3.1: b = 250, d = 450, M20, Fe415 → Mu 115.08 kN·m: Ast 837.75; Mu 121.5: Ast 895.84; Mu,lim 139.72
  it("singly reinforced (m3l6)", () => {
    const D = 450 + 25 + 8 + 8; // d = 450
    const a = designRcBeam({ code: "IS456", b: 250, D, cover: 25, stirrupDia: 8, mainBarDia: 16, fck: 20, fy: 415, Mu: 115.08 });
    close(a.AstRequired, 837.75, 0.002); close(a.MuLim!, 139.72, 0.002);
    close(designRcBeam({ code: "IS456", b: 250, D, cover: 25, stirrupDia: 8, mainBarDia: 16, fck: 20, fy: 415, Mu: 121.5 }).AstRequired, 895.84, 0.002);
  });
  it("doubly reinforced (m4l9 Problem 4.1: b 300, d 630, d' 70, M20, Fe415, Mu 482.96 → Asc 806.5, Ast 2572.8)", () => {
    const r = designRcBeam({ code: "IS456", b: 300, D: 700, cover: 52, stirrupDia: 8, mainBarDia: 20, fck: 20, fy: 415, Mu: 482.96 });
    close(r.d, 630, 0.001);
    close(r.AscRequired, 806.5, 0.01); // fsc from strain 350.0 vs 350.8 read from SP-16 Table F
    close(r.AstRequired, 2572.8, 0.005);
  });
  it("doubly reinforced Fe500 (m4l9 Q.1: b 250, d 500, d' 75, M30, Mu 375 → Mu,lim 250.51, Asc 767.56, Ast 2085.87)", () => {
    const r = designRcBeam({ code: "IS456", b: 250, D: 575, cover: 57, stirrupDia: 8, mainBarDia: 20, fck: 30, fy: 500, Mu: 375 });
    // the source takes Ast1 from the rounded SP-16 pt,lim (1.13%); exact equilibrium gives Ast1 = 1427.6 → Ast = 2101 (0.7% higher)
    close(r.MuLim!, 250.51, 0.002); close(r.AscRequired, 767.56, 0.01); close(r.AstRequired, 2085.87, 0.01);
  });
  it("shear strength τc for pt = 1.43% (m6l14: 0.706 MPa)", () => { close(tauC_IS(20, 1.43), 0.706, 0.015); });
});

describe("IS 456 columns with SP-16 charts (NPTEL m10l25 / m10l26, Nataraja VTU notes)", () => {
  it("uniaxial, 400×400, M25, Fe415, p = 2.5% on four faces, d'/D = 0.15 carries Mu ≈ 112 kN·m at Pu = 2240 kN (chart 45)", () => {
    const dia = Math.sqrt((4000 / 12) * 4 / Math.PI);
    const sec = { b: 400, h: 400, bars: perimeterBars(400, 400, 12, dia, 60 - 10 - dia / 2, 10) };
    close(momentCapacityAt(interactionCurve("IS456", sec, 25, 415, "x"), 2240), 112, 0.08); // chart read by eye
  });
  it("uniaxial, 450×450, M25, Fe415, p = 2.5% on four faces carries Mu ≈ 200 kN·m at Pu = 2500 kN", () => {
    const As = 0.025 * 450 * 450, dia = Math.sqrt((As / 12) * 4 / Math.PI);
    const sec = { b: 450, h: 450, bars: perimeterBars(450, 450, 12, dia, 67.5 - 10 - dia / 2, 10) };
    close(momentCapacityAt(interactionCurve("IS456", sec, 25, 415, "x"), 2500), 200, 0.1);
  });
  it("biaxial cl. 39.6 (m10l26 Problem 1: 400×500, 12 Ø20, Pu 2000: Puz 3380.7 kN, αn 1.658)", () => {
    const r = designColumn({ code: "IS456", b: 400, h: 500, fc: 25, fy: 415, Pu: 2000, Mux: 130, Muy: 120, lu: 3000, bars: { count: 12, dia: 20 } });
    const s = r.steps.join(" ");
    // the source prints αn = 1.658, but 1 + (2000/3380.7 − 0.2)/0.6 = 1.653 (an arithmetic slip in the source)
    expect(s).toMatch(/Puz = 338[01] kN, Pu\/Puz = 0\.59, αn = 1\.65/);
    // published sum 0.952 with chart-read Mux1 = 226.1, Muy1 = 171.6; ours comes from strain compatibility
    expect(r.capacity.biaxialRatio!).toBeGreaterThan(0.8); expect(r.capacity.biaxialRatio!).toBeLessThan(1.1);
    close(barArea(20) * 12, 3769, 0.001);
  });
});

describe("IS 456 isolated footing (NPTEL m11l29 Problem 2: 400×400 column, 1500 kN, SBC 250, M20, Fe415)", () => {
  it("plan 2.6 × 2.6 m and factored pressure 0.333 N/mm²", () => {
    const r = designIsolatedFooting({ code: "IS456", columnB: 400, columnD: 400, serviceLoad: 1500, safeBearingCapacity: 250, fck: 20, fy: 415 });
    expect(r.side).toBe(2.6);
    close(r.netUpwardPressure / 1000, 0.333, 0.005);
    expect(r.depth).toBeGreaterThanOrEqual(550); expect(r.depth).toBeLessThanOrEqual(700); // published D = 610 mm (shear at pt 0.25%)
  });
});

describe("Bearing capacity", () => {
  it("Terzaghi square footing (Das example: B 2 m, Df 1.5 m, c 20, φ 25°, γ 16.5 → qult 1078.29 kPa)", () => {
    const f = terzaghiFactors(25);
    close(f.Nc, 25.13, 0.002); close(f.Nq, 12.72, 0.002); close(f.Ng, 8.34, 0.001);
    const r = bearingCapacity({ cohesion: 20, frictionAngle: 25, unitWeight: 16.5, depth: 1.5, width: 2, shape: "square" });
    close(r.ultimate, 1078.29, 0.002);
  });
  it("Terzaghi square footing with the water table (Structville: B 2 m, Df 1 m, φ 30°, γ = γsat = 19)", () => {
    const base = { cohesion: 0, frictionAngle: 30, unitWeight: 19, saturatedUnitWeight: 19, depth: 1, width: 2, shape: "square" as const };
    close(bearingCapacity({ ...base, waterTableDepth: 5 }).ultimate, 717.516, 0.002);
    close(bearingCapacity({ ...base, waterTableDepth: 0 }).ultimate, 347.05, 0.002);
    close(bearingCapacity({ ...base, waterTableDepth: 1 }).ultimate, 567.38, 0.002);
    close(bearingCapacity({ ...base, waterTableDepth: 2 }).ultimate, 642.45, 0.002);
  });
  it("Terzaghi strip and φ = 0 square footings (Mustansiriya Univ. Examples 2 and 3, US units)", () => {
    const pcf = 0.157087; // kN/m³ per pcf
    // the source uses Terzaghi's original Nγ = 19.7; we use Kumbhojkar's 19.13 (Das), so 1.3% lower
    close(bearingCapacity({ cohesion: 0, frictionAngle: 30, unitWeight: 100 * pcf, depth: 2 * 0.3048, width: 3 * 0.3048, shape: "strip" }).ultimate / 0.04788, 7455, 0.015);
    close(bearingCapacity({ cohesion: 1000 * 0.04788, frictionAngle: 0, unitWeight: 120 * pcf, depth: 2 * 0.3048, width: 6 * 0.3048, shape: "square" }).ultimate / 0.04788, 7650, 0.005);
  });
  it("IS 6403 factors (NPTEL IIT Roorkee lecture 3: φ 25° → Nc 20.7, Nq 10.7, Nγ 10.9; dc 1.281, dq 1.14 at Df 1.5, B' 1.7)", () => {
    const f = is6403Factors(25);
    close(f.Nc, 20.7, 0.005); close(f.Nq, 10.7, 0.005); close(f.Ng, 10.9, 0.005);
    const r = bearingCapacity({ method: "is6403", cohesion: 15, frictionAngle: 25, unitWeight: 18, depth: 1.5, width: 1.7, length: 4, shape: "rectangular" });
    close(r.depthFactors!.dc, 1.281, 0.005); close(r.depthFactors!.dq, 1.14, 0.005);
  });
});

describe("Settlement", () => {
  it("normally consolidated clay (Das Ex. 11.5: H 3 m, e0 0.8, Cc 0.28, σ'0 135, Δσ 50 → 63.9 mm unrounded)", () => {
    close(consolidationSettlement({ thickness: 3, e0: 0.8, Cc: 0.28, sigma0: 135, deltaSigma: 50 }).settlement, 63.9, 0.003);
  });
  it("over-consolidated two-layer clay (ADU CE 366 P5: 158 mm and 14 mm)", () => {
    close(consolidationSettlement({ thickness: 6, e0: 0.8, Cc: 0.15, Cr: 0.05, sigma0: 68, deltaSigma: 88.8, sigmaP: 80 }).settlement, 158, 0.005);
    close(consolidationSettlement({ thickness: 6, e0: 0.6, Cc: 0.1, Cr: 0.03, sigma0: 128, deltaSigma: 41.6, sigmaP: 200 }).settlement, 14, 0.03);
  });
  it("2:1 stress and settlement under a 4 × 4 m footing (Structville: Δσ 21.13 kPa, Sc 43.15 mm)", () => {
    const dS = stress21(109.375, 4, 4, 5.1);
    close(dS, 21.13, 0.002);
    close(consolidationSettlement({ thickness: 3, e0: 0.92, Cc: 0.252, sigma0: 73.61, deltaSigma: dS }).settlement, 43.15, 0.004);
  });
  it("SPT allowable pressure for 40 mm settlement (Bowles Ex. 4-12: N60 6, Df 1.6 → 255.36, 200.6, 170.72, 157 kPa)", () => {
    close(sptAllowablePressure(6, 1, 1.6, 40), 255.36, 0.002);
    close(sptAllowablePressure(6, 2, 1.6, 40), 200.6, 0.002);
    close(sptAllowablePressure(6, 3, 1.6, 40), 170.72, 0.002);
    close(sptAllowablePressure(6, 4, 1.6, 40), 157, 0.003);
  });
});

describe("Rankine earth pressure", () => {
  it("surcharge (SKD notes: H 4, q 36, γ 18, φ 30° → 96 kN/m at 1.67 m)", () => {
    const r = earthPressure(30, 4, 18, 36, 0);
    close(r.activeForce, 96, 0.002); close(r.activeArm, 1.667, 0.003);
  });
  it("cohesive backfill with tension crack (Das/NPTEL: H 6, γ 17.4, φ 26°, c 14.36 → zc 2.64 m, 38.25 kN/m at 1.12 m)", () => {
    const r = earthPressure(26, 6, 17.4, 0, 14.36);
    close(r.tensionCrackDepth, 2.64, 0.01); close(r.activeForce, 38.25, 0.01); close(r.activeArm, 1.12, 0.01);
  });
  it("water table (RCET CE8591 P1: H 10, γ 18, φ 30°, water at 5 m, γ' 10 → 389.3 kN/m at 2.95 m)", () => {
    const r = earthPressure(30, 10, 18, 0, 0, { saturatedUnitWeight: 19.81, waterTableDepth: 5 });
    close(r.activeForce, 389.3, 0.003); close(r.activeArm, 2.95, 0.005);
  });
});

describe("Steel lateral-torsional buckling", () => {
  const w18 = findSection("W18x50")!;
  it("AISC Table 3-2 Lp and Lr for all W-shapes (Fy = 50 ksi)", () => {
    const table: [string, number, number][] = [["W8x18", 4.345, 13.485], ["W10x22", 4.698, 13.772], ["W12x26", 5.334, 14.884], ["W14x30", 5.263, 14.854], ["W16x36", 5.369, 15.232], ["W18x50", 5.828, 16.946], ["W21x62", 6.252, 18.131], ["W24x76", 6.782, 19.496]];
    for (const [name, Lp, Lr] of table) {
      const r = aiscF2(findSection(name)!, 50 * KSI, 1, 1);
      close(r.Lp / 304.8, Lp, 0.005); close(r.Lr / 304.8, Lr, 0.01); // rts from √(√(Iy·Cw)/Sx) vs tabulated rts
    }
  });
  it("AISC Design Example F.1-2B: W18x50, Lb 11.7 ft, Cb 1.01 → φMn = 305 kip-ft (inelastic LTB)", () => {
    close((0.9 * aiscF2(w18, 50 * KSI, 11.7 * 304.8, 1.01).Mn) / 1e6 / KFT, 305, 0.01);
  });
  it("AISC Design Example F.1-3B: W18x50, Lb 17.5 ft, Cb 1.30 → φMn = 288 kip-ft (elastic LTB)", () => {
    close((0.9 * aiscF2(w18, 50 * KSI, 17.5 * 304.8, 1.3).Mn) / 1e6 / KFT, 288, 0.012);
  });
  it("IS 800 cl. 8.2.2 / Annex E (Annamalai Univ. Problem 2: ISMB 225, 3 m unrestrained → Mcr 87.79, Md 52.91 kN·m)", () => {
    const Mcr = mcrIS800({ Iy: 218, It: 13.8926, Iw: 24770 }, 3000);
    close(Mcr / 1e6, 87.79, 0.002);
    const r = isLTB(348.27e3, 250, Mcr);
    close(r.lambdaLT, 0.9959, 0.002); close(r.chiLT, 0.6685, 0.002); close(r.fbd, 151.93, 0.002); close(r.Md / 1e6, 52.91, 0.003);
  });
});
