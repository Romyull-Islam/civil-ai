/**
 * Road geometric design checked against PUBLISHED values (inputs and answers as printed; each block names its source).
 * Tolerances reflect the rounding printed in the source, or a stated difference in constants (e.g. v in m/s with
 * g = 9.81 versus the 0.278/254 km/h form).
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  curveElements, deltaFromTangent, radiusFromExternal, horizontalCurve, formatChainage, parseChainage, deflectionTable,
  minRadius, roundAashtoRadius, aashtoMethod5, aashtoFmax, aashtoRunoff, safeSpeed, superelevationForFriction, ircSuperelevation,
  radiusSuperelevation, rhdSuperelevation, rhdTransition, rhdMinRadius, lgedTransition,
  aashtoSSD, ircSSD, sightDistance, AASHTO_RELATIVE_GRADIENT, AASHTO_K, interpTable, IRC_SSD_FRICTION,
  sightLength, crestConstant, sagComfortIRC, verticalCurve, roadCrossSection, rhdWidening, lgedWidening,
} from "@/lib/eng/roadgeo";
import { ROAD_TOOLS } from "@/lib/tools/road-tools";

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(rel);
const within = (a: number, b: number, abs: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(abs);
type R = Record<string, unknown>;

describe("Horizontal curve elements and chainage", () => {
  it("Δ 50°, R 300 m → T 139.9, L 261.8, LC 253.6, M 28.1, E 31.0 (textbook example as supplied)", () => {
    const e = curveElements(300, 50);
    within(e.T, 139.9, 0.05); within(e.L, 261.8, 0.05); within(e.LC, 253.6, 0.05); within(e.M, 28.1, 0.05); within(e.E, 31.0, 0.05);
  });
  it("PI 3+250, Δ 40°, R 400 m → T 145.6, L 279.3, PC 3+104.4, PT 3+383.7 (PT = PC + L, not PI + T)", () => {
    const r = horizontalCurve({ radius: 400, deflectionAngle: 40, piChainage: 3250 });
    within(r.T, 145.6, 0.05); within(r.L, 279.3, 0.05);
    within(r.pc, 3104.4, 0.05); within(r.pt, 3383.7, 0.05);
    expect(formatChainage(r.pc, "SI", 1)).toBe("3+104.4");
    expect(formatChainage(r.pt, "SI", 1)).toBe("3+383.7");
    expect(Math.abs(r.pt - (3250 + r.T))).toBeGreaterThan(10); // PI + T would be wrong by 11.9 m
  });
  it("Wikibooks Horizontal Curves Ex. 2: R 600 ft, T 52 ft, PI 200+00 → Δ 9.9°, L 104 ft, PC 199+48, PT 200+52", () => {
    within(deltaFromTangent(600, 52), 9.9, 0.05);
    const r = horizontalCurve({ units: "US", radius: 600, tangentLength: 52, piChainage: 20000 });
    within(r.L, 104, 0.5);
    expect(formatChainage(r.pc, "US", 0)).toBe("199+48");
    expect(formatChainage(r.pt, "US", 0)).toBe("200+52");
    expect(r.solvedFrom).toBe("R and T");
  });
  it("Mathalino Problem 02: I = 36°30′, E = 12.02 m → R = 226.94 m", () => {
    within(radiusFromExternal(12.02, 36.5), 226.94, 0.01);
    within(horizontalCurve({ deflectionAngle: 36.5, externalDistance: 12.02 }).R, 226.94, 0.01);
  });
  it("chainage format and parse round trip", () => {
    expect(formatChainage(3104.414, "SI")).toBe("3+104.41");
    expect(formatChainage(50, "SI")).toBe("0+050.00");
    expect(formatChainage(19948, "US")).toBe("199+48.00");
    expect(formatChainage(3999.999, "SI")).toBe("4+000.00");
    expect(parseChainage("3+104.4", "SI")).toBeCloseTo(3104.4, 6);
    expect(parseChainage("199+48", "US")).toBe(19948);
  });
  it("deflection-angle setting out: δ = 1718.87c/R minutes, sub-chords, and total = Δ/2", () => {
    const t = deflectionTable(400, 40, 3104.41, 20);
    within(t[0].arc, 15.59, 0.01); // first sub-chord to 3+120
    expect(t[0].chainage).toBe(3120);
    within(t[1].deflection * 60, (1718.873 * 20) / 400, 0.001); // full chord: 85.94′
    within(t[1].chord, 2 * 400 * Math.sin((t[1].deflection * Math.PI) / 180), 1e-9);
    within(t[t.length - 1].totalDeflection, 20, 1e-9);
    expect(t[t.length - 1].point).toBe("PT");
  });
  it("rejects insufficient input", () => {
    expect(() => horizontalCurve({ radius: 300 })).toThrow(/deflection angle/);
  });
});

describe("Minimum radius and superelevation", () => {
  it("Wikibooks Horizontal Curves Ex. 1: V 110 km/h, e 0.06, f 0.10 → R = 595 m", () => {
    within(minRadius(110, 0.06, 0.1), 595, 0.5);
  });
  it("NYSDOT Exhibit M2-14 / M2-13 Rmin at emax 8% and 6%: R = V²/(127(e + f)) rounded to the NEAREST metre (not up)", () => {
    const Vs = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const e8 = [7, 20, 41, 73, 113, 168, 229, 304, 394, 501, 667];
    Vs.forEach((V, i) => expect(roundAashtoRadius(minRadius(V, 0.08, aashtoFmax(V)))).toBe(e8[i]));
    expect(roundAashtoRadius(minRadius(20, 0.06, aashtoFmax(20)))).toBe(8);
    expect(roundAashtoRadius(minRadius(120, 0.06, aashtoFmax(120)))).toBe(756);
    // rounding UP does not reproduce the table (113.4 → 114, 229.1 → 230, 501.4 → 502)
    expect(Math.ceil(minRadius(60, 0.08, 0.17))).toBe(114);
    expect(Math.ceil(minRadius(80, 0.08, 0.14))).toBe(230);
  });
  it("TxDOT RDM Tables 4-7/4-6 (US, AASHTO Method 5): Rmin at emax 8% and 6%, R = V²/(15(0.01e + f))", () => {
    const Vs = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
    const e8 = [38, 76, 134, 214, 314, 444, 587, 758, 960, 1200, 1480, 1810, 2210, 2670];
    const e6 = [39, 81, 144, 231, 340, 485, 643, 833, 1060, 1330, 1660, 2040, 2500, 3050];
    Vs.forEach((V, i) => {
      expect(roundAashtoRadius(minRadius(V, 0.08, aashtoFmax(V, "US"), "US"))).toBe(e8[i]);
      expect(roundAashtoRadius(minRadius(V, 0.06, aashtoFmax(V, "US"), "US"))).toBe(e6[i]);
    });
  });
  it("AASHTO Method 5 reproduces NYSDOT M2-14 (SI, emax 8%) rows e = 3.0% and 6.0%", () => {
    const Vs = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const rows: [number, number[]][] = [[0.03, [81, 199, 354, 496, 684, 916, 1150, 1410, 1730, 2000, 2370]], [0.06, [19, 55, 106, 172, 253, 360, 469, 595, 746, 894, 1100]]];
    // at 20–30 km/h the tabulated radii are small whole metres, so e is reproduced to 0.25%; 0.1% from 40 km/h up
    for (const [e, Rs] of rows) Vs.forEach((V, i) => within(aashtoMethod5(V, Rs[i], 0.08).e, e, V <= 30 ? 0.0025 : 0.001));
  });
  it("AASHTO Method 5 reproduces TxDOT Table 4-7 (US, emax 8%) rows e = 4.0% and 6.0%", () => {
    const Vs = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
    const rows: [number, number[]][] = [[0.04, [277, 490, 729, 1030, 1370, 1770, 2220, 2720, 3270, 3890, 4450, 5050, 5710, 6420]], [0.06, [105, 199, 332, 506, 713, 965, 1250, 1560, 1920, 2320, 2710, 3150, 3620, 4140]]];
    for (const [e, Rs] of rows) Vs.forEach((V, i) => within(aashtoMethod5(V, Rs[i], 0.08, "US").e, e, 0.001));
  });
  it("AASHTO design case: 80 km/h, R 469 m, emax 8% → e 6.0%; runoff Lr = 3.6×6/0.50 = 43.2 m, TR = 14.4 m (Indiana Eq. 43-3.1/43-3.2)", () => {
    const r = radiusSuperelevation({ standard: "AASHTO", designSpeed: 80, radius: 469 }) as R;
    within(r.superelevationDesign as number, 0.06, 1e-9);
    const ro = r.runoff as ReturnType<typeof aashtoRunoff>;
    within(ro.runoff, 43.2, 1e-6); within(ro.tangentRunout, 14.4, 1e-6);
    // e < 1.5% → normal crown: NYSDOT M2-14 e = 1.5% at 2440 m for 80 km/h
    expect((radiusSuperelevation({ standard: "AASHTO", designSpeed: 80, radius: 3000 }) as R).crown).toBe("NC");
    expect((radiusSuperelevation({ standard: "AASHTO", designSpeed: 80, radius: 2000 }) as R).crown).toBe("RC");
  });
  it("AASHTO radius only: R 300 m at emax 8% suits 80 km/h but not 90 km/h (NYSDOT M2-14 Rmin 229 and 304 m)", () => {
    const r = radiusSuperelevation({ standard: "AASHTO", radius: 300 }) as R;
    expect(r.designSpeedTabulated).toBe(80);
    expect(r.safeSpeed as number).toBeGreaterThan(80); expect(r.safeSpeed as number).toBeLessThan(90);
    const c = radiusSuperelevation({ standard: "AASHTO", designSpeed: 80, radius: 469, superelevation: 5 }) as { checks: { name: string; ok: boolean }[] };
    expect(c.checks.find((x) => x.name.startsWith("Provided superelevation"))?.ok).toBe(false);
  });
  it("US relative gradients equal the metric AASHTO table at the equivalent km/h (consistency check)", () => {
    for (const [mph, d] of AASHTO_RELATIVE_GRADIENT.US) within(interpTable(AASHTO_RELATIVE_GRADIENT.SI, mph * 1.609344).value, d, 0.006);
  });
  it("NPTEL Ch. 15 (IRC, e 0.07, f 0.15): R 150 m, V 80 → allowable ≈ 64 km/h; R 200 → 74.75 km/h", () => {
    const a = ircSuperelevation(80, 150);
    expect(a.ok).toBe(false);
    expect(a.allowableSpeed!).toBeGreaterThanOrEqual(64); expect(a.allowableSpeed!).toBeLessThan(65); // √(127×150×0.22) = 64.7, printed 64
    within(ircSuperelevation(80, 200).allowableSpeed!, 74.75, 0.01);
    within(safeSpeed(200, 0.07, 0.15), 74.75, 0.01);
  });
  it("NPTEL Ch. 15: R 100 m, V 50, f 0.15 → e = 0.047; R 450, V 80 → e1 = 0.0629", () => {
    within(superelevationForFriction(50, 100, 0.15), 0.047, 0.0005);
    // IRC prints V²/(225R) = 0.0632; NPTEL works in m/s with g = 9.81, i.e. V²/(226R) = 0.0629
    close(ircSuperelevation(80, 450).e1, 0.0629, 0.006);
  });
  it("RHD p.26 worked example: 6.2 m road, 65 km/h, R 250 (SSD) → e 5%, Lp 35 m, desirable Lp 65 m with Lc 25 m, widening 0.6 m", () => {
    expect(rhdMinRadius(65, "two_lane", "SSD").R).toBe(250);
    expect(rhdMinRadius(65, "two_lane", "ISD").R).toBe(1000);
    const se = rhdSuperelevation(65, 250);
    expect(se.e).toBe(0.05);
    const tr = rhdTransition(65, 5);
    expect(tr.Lp).toBe(35);
    expect(tr.desirable).toEqual({ speed: 80, e: 7, Lp: 65, Lc: 25 });
    expect(rhdWidening(250, 6.2).widening).toBe(0.6);
    const r = radiusSuperelevation({ standard: "RHD", designSpeed: 65, radius: 250 }) as R;
    expect(r.superelevation).toBe(0.05);
    expect(r.checks as unknown[]).toEqual([expect.objectContaining({ ok: true })]);
  });
  it("RHD Table 5.2: between tabulated radii the next smaller radius governs; nil beyond; sharper than tabulated fails", () => {
    expect(rhdSuperelevation(65, 300).e).toBe(0.05);
    expect(rhdSuperelevation(65, 1500).status).toBe("nil");
    expect(rhdSuperelevation(65, 100).status).toBe("below");
    expect(rhdSuperelevation(100, 1000).e).toBe(0.03);
    expect(rhdSuperelevation(55, 250).speed).toBe(65); // 55 km/h uses the 65 km/h row
  });
  it("RHD: radius between the SSD and ISD standards is flagged (Sec. 5.2 step 3)", () => {
    const r = radiusSuperelevation({ standard: "RHD", designSpeed: 65, radius: 850 }) as { checks: { name: string; ok: boolean }[] };
    expect(r.checks.find((c) => c.name.startsWith("Radius not between"))?.ok).toBe(false);
  });
  it("LGED p.10–11 formulas as printed: E = V²/127R ≤ 1/15, transition max(V³/28R, QV²/28R), Table-6", () => {
    const r = radiusSuperelevation({ standard: "LGED", designSpeed: 50, radius: 100 }) as R;
    within(r.superelevation as number, 1 / 15, 1e-9);
    within(r.fRequired as number, 2500 / 12700 - 1 / 15, 1e-9);
    const t = lgedTransition(50, 100);
    within(t.L1, 125000 / 2800, 1e-9); within(t.L2, (73 * 2500) / 2800, 1e-9); expect(t.min).toBe(20);
    expect((radiusSuperelevation({ standard: "LGED", designSpeed: 40, radius: 460, roadClass: "union" }) as R).superelevation).toBe(0);
  });
});

describe("Sight distance", () => {
  it("AASHTO SSD metric (NYSDOT/Indiana): calculated 18.5 … 215.3 m and design values rounded up to 5 m", () => {
    const calc: [number, number, number][] = [[20, 18.5, 20], [30, 31.2, 35], [40, 46.2, 50], [50, 63.5, 65], [60, 83.0, 85], [70, 104.9, 105], [80, 129.0, 130], [90, 155.5, 160], [100, 184.2, 185], [110, 215.3, 220]];
    // the Green Book adds the reaction and braking distances after rounding each to 0.1 m (50 km/h: 34.8 + 28.7 = 63.5)
    const r1 = (x: number) => Math.round(x * 10) / 10;
    for (const [V, s, d] of calc) { const r = aashtoSSD(V); within(r1(r.reaction) + r1(r.braking), s, 1e-9); within(r.ssd, s, 0.1); expect(r.design).toBe(d); }
    expect(aashtoSSD(120).design).toBe(250); expect(aashtoSSD(130).design).toBe(285);
  });
  it("AASHTO SSD on grade, 100 km/h: −3% → 193.9 m, +3% → 174.0 m", () => {
    within(aashtoSSD(100, "SI", { grade: -3 }).ssd, 193.9, 0.05);
    within(aashtoSSD(100, "SI", { grade: 3 }).ssd, 174.0, 0.05);
  });
  it("AASHTO SSD US: 1.47Vt + 1.075V²/a gives design values whose K reproduce the US K tables", () => {
    const Vs = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
    const design = Vs.map((V) => aashtoSSD(V, "US").design);
    expect(design).toEqual([80, 115, 155, 200, 250, 305, 360, 425, 495, 570, 645, 730, 820, 910]);
    Vs.forEach((V, i) => {
      const S = design[i];
      const kc = (S * S) / 2158, ks = (S * S) / (400 + 3.5 * S);
      const tc = AASHTO_K.US.crest[i][1], ts = AASHTO_K.US.sag[i][1];
      expect(tc - kc).toBeGreaterThan(-0.05); expect(tc - kc).toBeLessThan(1);
      expect(ts - ks).toBeGreaterThan(-0.05); expect(ts - ks).toBeLessThan(1);
    });
  });
  it("AASHTO metric K tables follow from the design SSD (K = S²/658 crest, S²/(120 + 3.5S) sag)", () => {
    AASHTO_K.SI.crest.forEach(([V, K], i) => {
      const S = aashtoSSD(V).design;
      const kc = (S * S) / 658, ks = (S * S) / (120 + 3.5 * S);
      expect(K - kc).toBeGreaterThan(-0.05); expect(K - kc).toBeLessThan(1);
      const Ks = AASHTO_K.SI.sag[i][1];
      expect(Ks - ks).toBeGreaterThan(-0.05); expect(Ks - ks).toBeLessThan(1);
    });
  });
  it("NPTEL Ch. 13 (IRC): V 50, f 0.37 → 61.4 m (single-lane two-way 122.8); V 65, f 0.36 → 91.4 (ISD 182.8); V 80, −2%, f 0.35 → ≈ 132 m", () => {
    // NPTEL uses 0.278Vt + V²/254f; the m/s form with g = 9.81 differs by < 0.2%
    close(ircSSD(50, { f: 0.37 }).ssd, 61.4, 0.003);
    const r = sightDistance({ standard: "IRC", designSpeed: 65, friction: 0.36 }) as R;
    close(r.ssd as number, 91.4, 0.003); close(r.isd as number, 182.8, 0.003);
    close((sightDistance({ standard: "IRC", designSpeed: 50, friction: 0.37 }) as R).singleLaneTwoWay as number, 122.8, 0.003);
    close(ircSSD(80, { f: 0.35, grade: -2 }).ssd, 132, 0.004);
    expect(ircSSD(65).f).toBe(0.36); // IRC:SP:23 default by speed
  });
  it("RHD Table 2.3 at 65 km/h: SSD 90, ISD 180, OSD 360 m; single-lane roads designed to ISD", () => {
    const r = sightDistance({ standard: "RHD", designSpeed: 65, roadType: "single_lane" }) as R;
    expect([r.ssd, r.isd, r.osd, r.design]).toEqual([90, 180, 360, 180]);
  });
});

describe("Vertical curves", () => {
  it("crest constants from eye/object heights: 658, 2158, 440, 960", () => {
    within(crestConstant(1.08, 0.6), 658, 0.1); within(crestConstant(3.5, 2.0), 2158, 0.5);
    within(crestConstant(1.2, 0.15), 440, 0.5); within(crestConstant(1.2, 1.2), 960, 1e-9);
  });
  it("RHD p.32 worked example: +6% to −4%, 65 km/h, ISD, K 35 → L = 350 m; S > L check 2×180 − 960/10 = 264 m", () => {
    const r = verticalCurve({ standard: "RHD", g1: 6, g2: -4, designSpeed: 65, sightDistanceType: "ISD" }) as R;
    expect(r.Kmin).toBe(35);
    within(r.requiredLength as number, 350, 1e-9);
    const s = r.sight as ReturnType<typeof sightLength>;
    within(s.formulaSgeL, 264, 1e-9);
    expect(s.case).toBe("S<L");
  });
  it("NPTEL Ch. 17 (IRC): +3% to −5%, V 80, SSD 128 m → crest L = 298 m", () => {
    const r = verticalCurve({ standard: "IRC", g1: 3, g2: -5, sightDistance: 128 }) as R;
    within((r.sight as { L: number }).L, 298, 0.5);
  });
  it("Indiana DM Ex. 44-3.2 (AASHTO sag): 90 km/h, −1.5% to +2.0%, K 38 → L = 133 m", () => {
    const r = verticalCurve({ standard: "AASHTO", g1: -1.5, g2: 2, designSpeed: 90 }) as R;
    expect(r.Kmin).toBe(38);
    within(r.requiredLength as number, 133, 1e-9);
  });
  it("NPTEL Ch. 18 (IRC sag): 1 in 25 down to 1 in 30 up, V 80, SSD 127.3 → comfort 73.1 m, headlight 199.5 m, design 199.5 m", () => {
    close(sagComfortIRC(4 + 100 / 30, 80), 73.1, 0.003); // NPTEL rounds v to 22.2 m/s
    const r = verticalCurve({ standard: "IRC", g1: -4, g2: 100 / 30, designSpeed: 80, sightDistance: 127.3 }) as R;
    within((r.sight as { L: number }).L, 199.5, 0.1);
    within(r.requiredLength as number, 199.5, 0.1);
  });
  it("USACE AED AASHTO crest: +2.00% to −3.75%, 100 km/h, S 185 m → L = 299.08 m (S < L valid)", () => {
    const r = verticalCurve({ standard: "AASHTO", g1: 2, g2: -3.75, designSpeed: 100 }) as R;
    expect(r.sightDistance).toBe(185);
    const s = r.sight as ReturnType<typeof sightLength>;
    expect(s.case).toBe("S<L"); within(s.L, 299.08, 0.01);
  });
  it("USACE AED AASHTO crest +8.00% to +4.15%, 80 km/h: published 98.88 m is WRONG (98.88 < S = 130 m); S ≥ L gives 2S − 658/A = 89.09 m", () => {
    const r = verticalCurve({ standard: "AASHTO", g1: 8, g2: 4.15, designSpeed: 80 }) as R;
    expect(r.sightDistance).toBe(130); // AASHTO design SSD at 80 km/h
    const s = r.sight as ReturnType<typeof sightLength>;
    within(s.formulaSltL, 98.88, 0.01); // the published value, from the S < L formula
    expect(s.case).toBe("S>=L");
    within(s.L, 89.09, 0.01);
    // the AASHTO design length still follows the rounded K: 26 × 3.85 = 100.1 m
    within(r.requiredLength as number, 100.1, 1e-9);
  });
  it("PVC/PVT, high point and levels (g1 +2%, g2 −1.5%, L 400 ft, PVI 10+00 at 100.00 ft)", () => {
    const r = verticalCurve({ units: "US", g1: 2, g2: -1.5, length: 400, pviChainage: 1000, pviLevel: 100 }) as R;
    expect(r.pvcLabel).toBe("8+00.00"); expect(r.pvtLabel).toBe("12+00.00");
    within(r.pvcLevel as number, 96, 1e-9); within(r.pvtLevel as number, 97, 1e-9);
    const tp = r.turningPoint as { x: number; level: number };
    within(tp.x, (2 * 400) / 3.5, 1e-9); within(tp.level, 96 + (4 * 400) / (200 * 3.5), 1e-9);
    within(r.midCurveLevel as number, 100 - (3.5 * 400) / 800, 1e-9); // PVI offset = A·L/800
    const levels = r.levels as { point: string; level: number }[];
    expect(levels[0].point).toBe("PVC"); expect(levels[levels.length - 1].point).toBe("PVT");
  });
  it("sight-length case choice: S ≥ L with no curve needed gives 0", () => {
    expect(sightLength("crest", 0.5, 100, 658)).toMatchObject({ case: "S>=L", L: 0 });
  });
});

describe("Cross-sections and widening", () => {
  it("RHD Table 2.1 / Fig. 4.5: Type 4 = 6.2 m carriageway, 1.5 m shoulders, 1.45 m verges, 12.1 m crest; 1000 PCU/h → Type 4", () => {
    const r = roadCrossSection({ standard: "RHD", pcuPeakHour: 1000, radius: 100 }) as R;
    expect(r.designType).toBe(4);
    expect((r.checks as { ok: boolean }[]).every((c) => c.ok)).toBe(true);
    expect(r.widening).toBe(1.2); // Table 5.4, 66–120 m band, 6.2 m road
  });
  it("RHD Table 5.4 and all six crest widths add up", () => {
    for (const t of [1, 2, 3, 4, 5, 6]) expect(((roadCrossSection({ standard: "RHD", designType: t }) as R).checks as { ok: boolean }[])[0].ok).toBe(true);
    expect(rhdWidening(15, 3.7).widening).toBe(1.8);
    expect(rhdWidening(20.5, 7.3).widening).toBe(1.8); // between bands → band below (more widening)
    expect(rhdWidening(700, 6.2).widening).toBe(0);
  });
  it("LGED Table-3/4/7: 150 CV/day → Type 6 (3.7 m, crest 7.3 m); R 100 m → 0.9 m extra, curve carriageway 5.5 + 0.9", () => {
    const r = roadCrossSection({ standard: "LGED", commercialVehiclesPerDay: 150, radius: 100 }) as R;
    expect(r.designType).toBe(6);
    expect(r.widening).toBe(0.9);
    within(r.carriagewayOnCurve as number, 6.4, 1e-9);
    expect(lgedWidening(60).widening).toBe(1.2); expect(lgedWidening(901).widening).toBe(0);
    for (const t of [4, 5, 6, 7, 8]) expect(((roadCrossSection({ standard: "LGED", designType: t }) as R).checks as { ok: boolean }[])[0].ok).toBe(true);
  });
});

describe("Road tools run end to end", () => {
  const tool = (n: string) => ROAD_TOOLS.find((t) => t.name === n)!;
  it("all five tools are defined in the transport category", () => {
    expect(ROAD_TOOLS.map((t) => t.name).sort()).toEqual(["curve_radius_superelevation", "horizontal_curve", "road_cross_section", "sight_distance", "vertical_curve"]);
    expect(ROAD_TOOLS.every((t) => t.category === "transport")).toBe(true);
  });
  it("schemas convert to JSON Schema as the registry does (draft-7, input)", () => {
    for (const t of ROAD_TOOLS) {
      const js = z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }) as { type: string; properties: Record<string, unknown>; required?: string[] };
      expect(js.type, t.name).toBe("object");
      expect(Object.keys(js.properties).length, t.name).toBeGreaterThan(3);
    }
  });
  it("each tool returns a display and a summary", async () => {
    const cases: [string, unknown][] = [
      ["horizontal_curve", { radius: 400, deflectionAngle: 40, piChainage: 3250 }],
      ["horizontal_curve", { radius: 400, deflectionAngle: 40, piChainage: 3250, showTable: true }],
      ["curve_radius_superelevation", { standard: "AASHTO", units: "US", designSpeed: 60, radius: 2320 }],
      ["curve_radius_superelevation", { standard: "IRC", designSpeed: 80, radius: 150 }],
      ["sight_distance", { standard: "AASHTO", designSpeed: 100, grade: -3 }],
      ["vertical_curve", { standard: "AASHTO", g1: 8, g2: 4.15, designSpeed: 80, pviChainage: 1250, pviLevel: 20, showTable: true }],
      ["road_cross_section", { standard: "RHD", designType: 4, radius: 250 }],
    ];
    for (const [n, inp] of cases) {
      const t = tool(n);
      const out = await t.run(t.schema.parse(inp));
      expect(out.summary, n).toBeTruthy();
      expect(["steps", "table"]).toContain(out.display?.kind);
    }
    const us = await tool("curve_radius_superelevation").run(tool("curve_radius_superelevation").schema.parse({ standard: "AASHTO", units: "US", designSpeed: 60, radius: 2320 }));
    expect(us.summary).toMatch(/e = 6\.0%/);
  });
});

describe("values checked against sources (not general knowledge)", () => {
  it("IRC friction for SSD equals NPTEL Ch. 13 Table 13.1 (≤30: 0.40, 40: 0.38, 50: 0.37, 60: 0.36, ≥80: 0.35)", () => {
    for (const [V, f] of [[30, 0.4], [40, 0.38], [50, 0.37], [60, 0.36], [80, 0.35], [100, 0.35]]) expect(interpTable(IRC_SSD_FRICTION, V).value).toBeCloseTo(f, 9);
  });
  it("relative gradient: Indiana Fig. 43-3E values only (20–120 km/h); above that the DOT value must be entered", () => {
    expect(AASHTO_RELATIVE_GRADIENT.SI.at(-1)).toEqual([120, 0.38]);
    expect(() => aashtoRunoff(130, 8)).toThrow(/relative gradient/);
    expect(aashtoRunoff(130, 8, "SI", { relativeGradient: 0.35 }).relativeGradient).toBe(0.35);
    expect(() => aashtoRunoff(80, 8, "US")).toThrow(/relative gradient/);
    expect(aashtoRunoff(100, 6).relativeGradient).toBe(0.44);
  });
});
