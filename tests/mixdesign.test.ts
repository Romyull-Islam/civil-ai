/**
 * Concrete mix design checked against PUBLISHED worked examples (inputs and answers as printed in the source) and the code
 * rules for f'cr and durability. Tolerance ±2 kg/m³ unless stated: the sources round intermediate volumes and masses
 * (e.g. ACI prints 0.292 m³ of sand, then 771 kg). Inch-pound results use ±3 lb/yd³ (= 1.8 kg/m³, inside the ±2 kg/m³).
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { designAciMix, designIsMix, requiredAverageStrength, stdDevFactor, isTargetStrength, isWcFromFig1, type AciMixInput } from "@/lib/eng/mixdesign";
import { MIX_TOOLS } from "@/lib/tools/mix-tools";

const near = (a: number, b: number, tol = 2) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

describe("ACI 211.1-91 Appendix 2, SI Example 1 (pp. 211.1-23 to -24)", () => {
  // f'cr 24 MPa, slump 75–100 mm, non-air-entrained; 37.5 mm CA, dry-rodded 1600 kg/m³, SG 2.68, absorption 0.5%;
  // sand SG 2.64, absorption 0.7%, FM 2.8; cement SG 3.15; moisture 2% (CA) and 6% (sand).
  // The page prints "1.000 − 0.705" for the sand volume; the sum of the listed volumes is 0.708 and the answer 0.292 m³ uses it.
  const ex: AciMixInput = { code: "ACI318", fc: 24, fcrOverride: 24, slump: 100, nms: 37.5, fm: 2.8, caDryRoddedDensity: 1600, caSG: 2.68, faSG: 2.64, caAbsorption: 0.5, faAbsorption: 0.7, caMoisture: 2, faMoisture: 6 };
  it("water 181, w/c 0.62 (24 MPa interpolated, 0.626 taken down to 0.62), cement 292, coarse 1136 kg (dry)", () => {
    const r = designAciMix(ex);
    expect(r.water).toBe(181);
    expect(r.wc).toBe(0.62);
    near(r.cement, 292);
    near(r.coarseDry, 1136);
    expect(r.air).toBe(1);
  });
  it("sand by absolute volume: volumes 0.181 + 0.093 + 0.424 + 0.010 = 0.708 m³ → 0.292 m³ → 771 kg", () => {
    const r = designAciMix(ex);
    near(r.volumes.water, 0.181, 0.0005); near(r.volumes.cement, 0.093, 0.0005); near(r.volumes.coarse, 0.424, 0.0005); near(r.volumes.air, 0.01, 1e-9);
    near(r.volumes.known, 0.708, 0.0005);
    near(r.fineDry, 771);
  });
  it("sand by mass 2410 − 1609 = 801 kg; with 2%/6% moisture: water 122, coarse 1159, sand 849 (mass basis, A2.2.8)", () => {
    const r = designAciMix({ ...ex, fineAggregateMethod: "mass" });
    near(r.fineDry, 801);
    near(r.batches.field.water, 122);
    near(r.batches.field.coarse, 1159);
    near(r.batches.field.fine, 849);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
});

describe("ACI 211.1-91 inch-pound examples (Sec. 7.2 and 7.3), US units with the Chapter 6 tables", () => {
  const LB = 3; // lb/yd³
  it("Example 1: 3500 psi non-AE, 1½ in., 3–4 in. slump → water 300, w/c 0.62, cement 484, CA 1917; sand 1369 (weight) / 1318 (volume); field 199/1955/1451", () => {
    const base: AciMixInput = { units: "US", code: "ACI318", fc: 3500, fcrOverride: 3500, slump: 4, nms: 1.5, fm: 2.8, caDryRoddedDensity: 100, caSG: 2.68, faSG: 2.64, caAbsorption: 0.5, faAbsorption: 0.7, caMoisture: 2, faMoisture: 6 };
    const m = designAciMix({ ...base, fineAggregateMethod: "mass" });
    const us = m.batchesUS!;
    near(us.ssd.water, 300, 0.01); expect(m.wc).toBe(0.62); near(us.ssd.cement, 484, 0.01);
    near(us.dry.coarse, 1917, 1); near(us.dry.fine, 1369, 1);
    near(us.field.water, 199, LB); near(us.field.coarse, 1955, LB); near(us.field.fine, 1451, LB);
    near(designAciMix(base).batchesUS!.dry.fine, 1318, LB);
  });
  it("Example 2: 3000 psi AE, 1 in., 1–2 in. slump, severe freeze-thaw → water 270, w/c 0.59 → 0.50 (Table 6.3.4(b) governs), cement 540, CA 1719, sand 1321; field 170/1771/1387", () => {
    const base: AciMixInput = { units: "US", code: "ACI318", fc: 3000, fcrOverride: 3000, airEntrained: true, airExposure: "severe", freezeThaw: true, slump: 2, nms: 1, fm: 2.8, caDryRoddedDensity: 95, caSG: 2.68, faSG: 2.64, caAbsorption: 0.5, faAbsorption: 0.7, caMoisture: 3, faMoisture: 5 };
    const r = designAciMix(base);
    const us = r.batchesUS!;
    expect(r.wcStrength).toBe(0.59); expect(r.wc).toBe(0.5); expect(r.air).toBe(6);
    expect(r.wcGoverns).toMatch(/6\.3\.4\(b\)/);
    near(us.ssd.water, 270, 0.01); near(us.ssd.cement, 540, 0.01); near(us.dry.coarse, 1719, 1);
    // absolute volume: ACI rounds the volumes (18.98 ft³ → 8.02 ft³ of sand); unrounded 1322.7 lb
    near(us.dry.fine, 1321, LB);
    near(r.fineByMass * 1.685555, 1321, 1); // weight basis 3850 − 2529
    near(us.field.water, 170, LB); near(us.field.coarse, 1771, LB); near(us.field.fine, 1387, LB);
  });
});

describe("PCA EB001 Chapter 9, Example 1 (metric absolute volume)", () => {
  // f'c 35 MPa, no data → f'cr = 35 + 8.5 = 43.5 (PCA uses the ACI 318-02 +8.5 rule; ACI 318M-08 has +8.3), so f'cr is given.
  // Air 8% (PCA designs at the top of the 5–8% range, ACI's table value is 6%). PCA deducts 25 kg for rounded gravel, which is
  // ACI's inch-pound 25 lb (ACI SI says 15 kg for AE), so roundedAdjustment = 25. Then a 10% water reducer.
  const pca: AciMixInput = { code: "ACI318", fc: 35, fcrOverride: 43.5, airEntrained: true, airExposure: "severe", airOverride: 8, slump: 75, nms: 25, fm: 2.8, caDryRoddedDensity: 1600, caSG: 2.68, faSG: 2.64, caAbsorption: 0.5, faAbsorption: 0.7, caMoisture: 2, faMoisture: 6, cementSG: 3.0, roundedAggregate: true, roundedAdjustment: 25, waterReducerPercent: 10 };
  it("w/c 0.31 from the PCA Table 9-3 rows (40 MPa 0.34, 45 MPa 0.30), water 175 − 25 = 150 → 135, cement 435, CA 1072, sand 634, dry total 2276", () => {
    const r = designAciMix(pca);
    expect(r.wc).toBe(0.31);
    expect(r.water).toBe(135);
    near(r.cement, 435); // 135/0.31 = 435.5: PCA rounds to 435, we round cement up to 436
    near(r.coarseDry, 1072);
    near(r.fineDry, 634);
    near(r.water + r.cement + r.coarseDry + r.fineDry, 2276);
    expect(r.warnings.join(" ")).toMatch(/PCA EB001 Table 9-3/);
  });
  it("moisture 2%/6%: water 85, CA 1093, sand 672", () => {
    const f = designAciMix(pca).batches.field;
    near(f.water, 85); near(f.coarse, 1093); near(f.fine, 672);
  });
  it("without the PCA extension the ACI table (max 35 MPa air-entrained) is not extrapolated", () => {
    expect(() => designAciMix({ ...pca, allowPcaExtension: false })).toThrow(/not extrapolated/);
  });
  it("BNBC Table 6.5.5 gives the same +8.5 MPa; ACI 318M-08 gives +8.3", () => {
    expect(requiredAverageStrength({ code: "BNBC2020", fc: 35 }).fcr).toBeCloseTo(43.5, 9);
    expect(requiredAverageStrength({ code: "ACI318", fc: 35 }).fcr).toBeCloseTo(43.3, 9);
  });
});

describe("IS 10262:2019 Annex A (M40, PPC, 20 mm crushed, Zone II, slump 75 mm, severe RCC, superplasticiser)", () => {
  // Fig. 1 is read as 0.36 in Annex A; our digitisation of curve 2 gives about 0.35, so the published w/c is passed.
  const ann = { fck: 40, nms: 20, slump: 75, zone: "II" as const, cementType: "PPC" as const, cementSG: 2.88, caSG: 2.74, faSG: 2.65, caAbsorption: 0.5, faAbsorption: 1.0, caMoisture: 0, faMoisture: 0, admixtureDosagePercent: 1, admixtureSG: 1.145, waterReductionPercent: 23, wcOverride: 0.36, exposure: "severe" as const };
  it("f'ck = max(48.25, 46.5) = 48.25; air 1%; water 186 × 1.03 × 0.77 = 147.52 → 148; cement 412; CA fraction 0.648", () => {
    const r = designIsMix(ann);
    expect(r.targetStrength).toBeCloseTo(48.25, 9);
    expect(r.air).toBe(1);
    expect(r.water).toBe(148);
    expect(r.cement).toBe(412);
    expect(r.coarseFraction).toBeCloseTo(0.648, 9);
    near(r.admixture, 4.12, 0.005);
  });
  it("volumes 0.143 + 0.148 + 0.0036 → aggregate 0.695 m³; CA 1234, sand 648 kg (SSD)", () => {
    const r = designIsMix(ann);
    near(r.volumes.cement, 0.143, 0.0005); near(r.volumes.admixture, 0.0036, 0.00005); near(r.volumes.aggregate, 0.695, 0.0005);
    near(r.coarseSSD, 1234); near(r.fineSSD, 648);
  });
  it("dry aggregates (A-11/A-12): sand 642, CA 1228, water 148 + 6 + 6 = 160", () => {
    const f = designIsMix(ann).batches.field;
    near(f.fine, 642); near(f.coarse, 1228); near(f.water, 160);
    expect(designIsMix(ann).checks.every((c) => c.ok)).toBe(true);
  });
  it("without wcOverride the approximate Fig. 1 reading (curve 2) is about 0.35 and is flagged", () => {
    const r = designIsMix({ ...ann, wcOverride: undefined });
    expect(r.wcStrength).toBeGreaterThanOrEqual(0.34); expect(r.wcStrength).toBeLessThanOrEqual(0.36);
    expect(r.warnings.join(" ")).toMatch(/approximate reading of IS 10262 Fig\. 1/);
    expect(isWcFromFig1(48.25, 2).raw).toBeCloseTo(0.3484, 3);
    expect(() => isWcFromFig1(80, 2)).toThrow(/above IS 10262 Fig\. 1/);
  });
});

describe("Required average strength", () => {
  it("ACI 318M-08 Table 5.3.2.2 (no data)", () => {
    expect(requiredAverageStrength({ code: "ACI318", fc: 20 }).fcr).toBeCloseTo(27.0, 9);
    expect(requiredAverageStrength({ code: "ACI318", fc: 25 }).fcr).toBeCloseTo(33.3, 9);
    expect(requiredAverageStrength({ code: "ACI318", fc: 40 }).fcr).toBeCloseTo(49.0, 9);
  });
  it("ACI 318M-08 Table 5.3.2.1 with s (k from Table 5.3.1.2, interpolated)", () => {
    expect(stdDevFactor(17)).toBeCloseTo(1.128, 9);
    // f'c 30, s 3.5, 20 tests: k 1.08 → max(30 + 1.34·3.78, 30 + 2.33·3.78 − 3.5) = max(35.07, 35.31)
    expect(requiredAverageStrength({ code: "ACI318", fc: 30, stdDev: 3.5, numTests: 20 }).fcr).toBeCloseTo(35.3074, 3);
    // f'c 40 > 35: max(40 + 1.34·4, 0.9·40 + 2.33·4) = max(45.36, 45.32)
    expect(requiredAverageStrength({ code: "ACI318", fc: 40, stdDev: 4, numTests: 30 }).fcr).toBeCloseTo(45.36, 9);
    // fewer than 15 tests: the no-data table
    expect(requiredAverageStrength({ code: "ACI318", fc: 30, stdDev: 3, numTests: 10 }).fcr).toBeCloseTo(38.3, 9);
  });
  it("inch-pound ACI 318 (psi constants)", () => {
    expect(requiredAverageStrength({ code: "ACI318", units: "US", fc: 2500 }).fcr).toBe(3500);
    expect(requiredAverageStrength({ code: "ACI318", units: "US", fc: 4000 }).fcr).toBe(5200);
    expect(requiredAverageStrength({ code: "ACI318", units: "US", fc: 6000 }).fcr).toBeCloseTo(7300, 6);
    expect(requiredAverageStrength({ code: "ACI318", units: "US", fc: 4000, stdDev: 400, numTests: 30 }).fcr).toBeCloseTo(4536, 6);
  });
  it("BNBC 2020 Sec. 5.6.2.2: no 0.90f'c branch; Table 6.5.5 +7.0/+8.5/+10.0", () => {
    expect(requiredAverageStrength({ code: "BNBC2020", fc: 40, stdDev: 4, numTests: 30 }).fcr).toBeCloseTo(45.82, 9);
    expect(requiredAverageStrength({ code: "BNBC2020", fc: 17 }).fcr).toBeCloseTo(24, 9);
    expect(requiredAverageStrength({ code: "BNBC2020", fc: 20 }).fcr).toBeCloseTo(28.5, 9);
    expect(requiredAverageStrength({ code: "BNBC2020", fc: 40 }).fcr).toBeCloseTo(50, 9);
  });
  it("IS 10262 cl. 4.2 with Tables 1 and 2 (+1 MPa for fair site control)", () => {
    expect(isTargetStrength(20).target).toBeCloseTo(26.6, 9);
    expect(isTargetStrength(15).target).toBeCloseTo(20.775, 9);
    expect(isTargetStrength(40, undefined, "fair").target).toBeCloseTo(49.9, 9);
  });
});

describe("Table lookups: interpolation, snapping and no silent extrapolation", () => {
  const bd: AciMixInput = { fc: 25, slump: 100, nms: 20, fm: 2.6, caDryRoddedDensity: 1600, caSG: 2.65, faSG: 2.6, caAbsorption: 1, faAbsorption: 1.5 };
  it("20 mm is read as the 19 mm column; slump 60 mm interpolates between the 25–50 and 75–100 rows", () => {
    const r = designAciMix(bd);
    expect(r.water).toBe(205);
    expect(r.notes.join(" ")).toMatch(/20 mm is read as the 19 mm column/);
    expect(designAciMix({ ...bd, slump: 60 }).water).toBe(196); // 190 + 0.4 × (205 − 190)
    expect(r.coarseVolumeFraction).toBeCloseTo(0.64, 9);
  });
  it("FM outside 2.40–3.00 is clamped with a warning; slump above 175 mm is clamped with a warning", () => {
    const r = designAciMix({ ...bd, fm: 2.0 });
    expect(r.coarseVolumeFraction).toBeCloseTo(0.66, 9);
    expect(r.warnings.join(" ")).toMatch(/FM 2 is outside/);
    expect(designAciMix({ ...bd, slump: 200 }).warnings.join(" ")).toMatch(/superplasticiser/);
  });
  it("throws outside the tables instead of extrapolating", () => {
    expect(() => designAciMix({ ...bd, nms: 200 })).toThrow(/outside the ACI 211.1 tables/);
    expect(() => designAciMix({ ...bd, nms: 150, slump: 160 })).toThrow(/no water content/);
    expect(() => designAciMix({ ...bd, code: "ACI318", fc: 45 })).toThrow(/not extrapolated/);
    expect(() => designAciMix({ ...bd, slump: undefined })).toThrow(/slump/);
  });
  it("slump from the type of construction (Table A1.5.3.1): columns → 100 mm, +25 mm without vibration", () => {
    expect(designAciMix({ ...bd, slump: undefined, construction: "columns" }).slump).toBe(100);
    expect(designAciMix({ ...bd, slump: undefined, construction: "footings_walls", vibrated: false }).slump).toBe(100);
  });
  it("a size between columns is interpolated with a warning (16 mm between 12.5 and 19)", () => {
    const r = designAciMix({ ...bd, nms: 16 });
    expect(r.warnings.join(" ")).toMatch(/interpolated linearly between 12.5 and 19 mm/);
    near(r.water, 216 + ((16 - 12.5) / 6.5) * (205 - 216), 0.5);
  });
});

describe("BNBC 2020 durability checks (ACI 211.1 method, SI default code)", () => {
  const bd: AciMixInput = { fc: 25, slump: 100, nms: 20, fm: 2.6, caDryRoddedDensity: 1600, caSG: 2.65, faSG: 2.6, caAbsorption: 1, faAbsorption: 1.5 };
  it("SI defaults to BNBC2020: f'cr 33.5, strength w/c 0.49 governs Table 6.5.6 (0.50) and Table 6.8.3 (0.50, 325 kg)", () => {
    const r = designAciMix(bd);
    expect(r.code).toBe("BNBC2020");
    expect(r.fcr).toBeCloseTo(33.5, 9);
    expect(r.wc).toBe(0.49);
    expect(r.wcLimits.map((l) => l.wc)).toEqual([0.5, 0.5]);
    expect(r.cement).toBe(Math.ceil(205 / 0.49 - 1e-6));
  });
  it("f'c 30 without data: Table 6.5.6 limits w/c to 0.40 (strength alone gives 0.43)", () => {
    const r = designAciMix({ ...bd, fc: 30 });
    expect(r.wcStrength).toBe(0.43);
    expect(r.wc).toBe(0.4);
    expect(r.wcGoverns).toMatch(/Table 6\.5\.6/);
  });
  it("corrosive environment (8.1.7.8): cement ≥ 400, w/c ≤ 0.45; brick chips and FM < 2.2 fail", () => {
    const r = designAciMix({ ...bd, fc: 20, corrosive: true, brickAggregate: true, fm: 2.1 });
    expect(r.cement).toBeGreaterThanOrEqual(400);
    expect(r.wc).toBeLessThanOrEqual(0.45);
    const failing = r.checks.filter((c) => !c.ok).map((c) => c.name).join(" | ");
    expect(failing).toMatch(/minimum strength \(corrosive\)/);
    expect(failing).toMatch(/stone chips/);
    expect(failing).toMatch(/FM ≥ 2.20/);
  });
  it("sea water 0.40 (0.45 with cover +12 mm); piles 350/400 kg; minimum strength 20 MPa (17 up to 4 storeys)", () => {
    expect(designAciMix({ ...bd, seaWater: true }).wc).toBe(0.4);
    expect(designAciMix({ ...bd, seaWater: true, extraCover12mm: true }).wcLimits.find((l) => /5\.5\.1\.2/.test(l.source))!.wc).toBe(0.45);
    const pile = designAciMix({ ...bd, fc: 20, slump: 150, element: "large_pile", waterReducerPercent: 20 });
    expect(pile.cement).toBeGreaterThanOrEqual(400);
    expect(designAciMix({ ...bd, fc: 17 }).checks.find((c) => /5\.5\.4/.test(c.name))!.ok).toBe(false);
    expect(designAciMix({ ...bd, fc: 17, upTo4Storeys: true }).checks.find((c) => /5\.5\.4/.test(c.name))!.ok).toBe(true);
    expect(designAciMix({ ...bd, fc: 20, environment: "severe" }).checks.find((c) => /Table 6\.8\.3/.test(c.name))!.ok).toBe(false);
  });
  it("minimum cement governs: cement raised, effective w/c noted", () => {
    const r = designAciMix({ ...bd, fc: 20, minCement: 450 });
    expect(r.cement).toBe(450);
    expect(r.steps.join(" ")).toMatch(/effective w\/c/);
  });
});

describe("IS 456 durability in the IS 10262 design", () => {
  const base = { fck: 25, nms: 20, slump: 50, zone: "II" as const, caSG: 2.7, faSG: 2.65, caAbsorption: 0.5, faAbsorption: 1, exposure: "mild" as const };
  it("minimum grade (Table 5) and Table 6 cement adjustment for 40 mm", () => {
    expect(designIsMix({ ...base, fck: 20, exposure: "severe" }).checks.find((c) => /Minimum grade/.test(c.name))!.ok).toBe(false);
    const r = designIsMix({ ...base, nms: 40, exposure: "severe", fck: 30 });
    expect(r.checks.find((c) => /Minimum cement/.test(c.name))!.detail).toMatch(/≥ 290/);
  });
  it("maximum cement 450 kg/m³ (cl. 8.2.4.2) fails for a rich mix without admixture", () => {
    const r = designIsMix({ ...base, fck: 50, nms: 10, slump: 100, exposure: "severe" });
    expect(r.cement).toBeGreaterThan(450);
    expect(r.checks.find((c) => /Maximum cement/.test(c.name))!.ok).toBe(false);
  });
  it("project minimum cement governs over W/(w/c)", () => {
    const r = designIsMix({ ...base, wcOverride: 0.5, minCement: 400 });
    expect(r.water).toBe(186);
    expect(r.cement).toBe(400);
  });
  it("M65 and above is outside Section 2", () => {
    expect(() => designIsMix({ ...base, fck: 65 })).toThrow(/Section 3/);
  });
});

describe("mix tools (MIX_TOOLS)", () => {
  const aci = MIX_TOOLS.find((t) => t.name === "mix_design_aci")!;
  const is = MIX_TOOLS.find((t) => t.name === "mix_design_is10262")!;
  it("two tools in the materials category with portable JSON schemas", () => {
    expect(MIX_TOOLS.map((t) => t.name)).toEqual(["mix_design_aci", "mix_design_is10262"]);
    for (const t of MIX_TOOLS) {
      expect(t.category).toBe("materials");
      expect(() => z.toJSONSchema(t.schema, { target: "draft-7", io: "input" })).not.toThrow();
    }
  });
  it("ACI tool: batch table (oven-dry, SSD, field, volume, per 50 kg bag), cft rows, workbook and summary", async () => {
    const input = aci.schema.parse({ fc: 25, slump: 100, nms: 20, fm: 2.6, caDryRoddedDensity: 1600, caSG: 2.65, faSG: 2.6, caAbsorption: 1, faAbsorption: 1.5, caMoisture: 3, faMoisture: 5, volume: 100, volumeUnit: "cft", wastagePercent: 3, sandLooseDensity: 1500, stoneLooseDensity: 1450 });
    const out = await aci.run(input);
    expect(out.display?.kind).toBe("table");
    if (out.display?.kind !== "table") return;
    expect(out.display.columns).toEqual(["Material", "Oven-dry aggregates (kg/m³)", "SSD aggregates (kg/m³)", "Field, moist (kg/m³)", "Field for 100 cft + 3% (kg)", "Per 50 kg bag (kg)"]);
    const labels = out.display.rows.map((r) => String(r[0]));
    expect(labels).toContain("Cement bags (50 kg)");
    expect(labels).toContain("Sand, loose (cft)");
    expect(out.summary).toMatch(/BNBC 2020.*trial mixes/);
    expect(out.workbook?.sheets.map((s) => s.name)).toEqual(["Batch quantities", "Design steps", "Checks and notes"]);
    const res = out.result as { perCementBag: { cement: number; fine: number }; forVolume: { cementBags50kg: number } };
    expect(res.perCementBag.cement).toBe(50);
    const cementRow = out.display.rows.find((r) => r[0] === "Cement (kg)")!;
    near(Number(cementRow[4]), Number(cementRow[3]) * (100 / 35.3147) * 1.03, 1);
  });
  it("ACI tool in US units: lb/yd³ columns and 94-lb sacks", async () => {
    const input = aci.schema.parse({ units: "US", fc: 3000, fcrOverride: 3000, airEntrained: true, airExposure: "severe", freezeThaw: true, slump: 2, nms: 1, fm: 2.8, caDryRoddedDensity: 95, caSG: 2.68, faSG: 2.64, caAbsorption: 0.5, faAbsorption: 0.7, caMoisture: 3, faMoisture: 5 });
    const out = await aci.run(input);
    if (out.display?.kind !== "table") throw new Error("table expected");
    expect(out.display.columns[3]).toBe("Field, moist (lb/yd³)");
    expect(out.display.columns.at(-1)).toBe("Per 94-lb sack (lb)");
    const cem = out.display.rows.find((r) => r[0] === "Cement (lb)")!;
    expect(cem[2]).toBe(540);
    expect(cem.at(-1)).toBe(94);
    expect(out.summary).toMatch(/ACI 318.*w\/c 0\.50/);
  });
  it("IS tool: Annex A through the schema", async () => {
    const input = is.schema.parse({ fck: 40, nms: 20, slump: 75, zone: "II", cementType: "PPC", cementSG: 2.88, caSG: 2.74, faSG: 2.65, caAbsorption: 0.5, faAbsorption: 1, caMoisture: 0, faMoisture: 0, admixtureDosagePercent: 1, admixtureSG: 1.145, waterReductionPercent: 23, wcOverride: 0.36, exposure: "severe" });
    const out = await is.run(input);
    if (out.display?.kind !== "table") throw new Error("table expected");
    const cem = out.display.rows.find((r) => r[0] === "Cement (kg)")!;
    expect(cem[2]).toBe(412);
    expect(out.display.rows.map((r) => String(r[0]))).toContain("Chemical admixture (kg)");
    expect(out.summary).toMatch(/IS 10262:2019.*All checks pass/);
  });
});
