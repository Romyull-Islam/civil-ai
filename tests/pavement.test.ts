/**
 * Pavement calculators checked against PUBLISHED worked examples (inputs and answers as printed in the source).
 * AASHTO examples read SN / D from nomographs, so each is asserted twice: tightly against the design equation value
 * (our solver) and loosely against the printed answer (chart-reading and rounding in the source).
 */
import { describe, it, expect } from "vitest";
import {
  zrFromReliability, ZR_TABLE, designFlexible, designRigid, cumulativeESAL, rhdFlexibleDesign, growthFactor, mrFromCBR,
  drainageCoefficientM, drainageCoefficientCd, aashtoMinimumThickness, aashtoFlexibleLEF, lefFourthPower, loadTransferJ,
  ircIndicativeVDF, rhdImprovedSubgrade, baseCoefficient, subbaseCoefficient, PSI_PER_MPA, MPA_PER_M_PER_PCI, RHD_CUMULATIVE,
} from "@/lib/eng/pavement";
import { PAVEMENT_TOOLS } from "@/lib/tools/pavement-tools";
import { toolJsonSchema } from "@/lib/tools";

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(rel);
const sn = (W18: number, R: number, S0: number, deltaPSI: number, MR: number) => designFlexible({ W18, reliability: R, S0, deltaPSI, MR }).SN;
/** published SN: |SN − equation| ≤ 0.02 and |SN − published| ≤ 0.06 */
const snCase = (W18: number, R: number, S0: number, dPSI: number, MR: number, eq: number, pub: number) => { const s = sn(W18, R, S0, dPSI, MR); near(s, eq, 0.02); near(s, pub, 0.06); };

describe("Reliability ZR (AASHTO 1993 Part I Table 4.1)", () => {
  it("exact normal deviate reproduces the table to 0.001", () => {
    for (const [R, z] of ZR_TABLE) if (R !== 99.99) near(zrFromReliability(R), z, 0.001);
  });
  it("99.99 %: the table prints −3.750 but the exact deviate is −3.719 (the exact value is used)", () => {
    near(zrFromReliability(99.99), -3.719, 0.001);
  });
  it("rejects reliability outside 50–99.99 %", () => {
    expect(() => zrFromReliability(49)).toThrow(/Reliability must be between 50 and 99.99/);
    expect(() => zrFromReliability(99.999)).toThrow(/Reliability/);
  });
});

describe("AASHTO 1993 flexible SN (published examples)", () => {
  it("AASHTO Fig 3.1 nomograph: W18 5e6, R 95, S0 0.35, MR 5000, ΔPSI 1.9 → SN 5.0 [eq 4.98]", () => snCase(5e6, 95, 0.35, 1.9, 5000, 4.98, 5.0));
  it("AASHTO App. H: W18 18.6e6, MR 5700, R 95, S0 0.35, ΔPSI 2.1 → SN 5.6 [eq 5.55]", () => snCase(18.6e6, 95, 0.35, 2.1, 5700, 5.55, 5.6));
  it("AASHTO App. H: SN1 (MR 30000, W18 16.0e6, ΔPSI 1.89) → 3.2 [3.18]; SN2 (MR 11000) → 4.5 [4.53]", () => {
    snCase(16.0e6, 95, 0.35, 1.89, 30000, 3.18, 3.2);
    snCase(16.0e6, 95, 0.35, 1.89, 11000, 4.53, 4.5);
  });
  it("FHWA NHI-05-037 Ch. 6: W18 6.1e6, R 90, S0 0.45, ΔPSI 1.7, MR 7500 → 4.61", () => snCase(6.1e6, 90, 0.45, 1.7, 7500, 4.61, 4.61));
  it("FHWA NHI-05-037 App. C: W18 11.6e6 (same inputs) → 5.07", () => snCase(11.6e6, 90, 0.45, 1.7, 7500, 5.07, 5.07));
  it("JICA Bangladesh designs (ΔPSI 1.7, S0 0.45, MR 7500)", () => {
    snCase(15980314, 90, 0.45, 1.7, 7500, 5.3, 5.3);
    snCase(6493463, 85, 0.45, 1.7, 7500, 4.48, 4.5);
    snCase(6538801, 85, 0.45, 1.7, 7500, 4.49, 4.5);
    snCase(10722822, 85, 0.45, 1.7, 7500, 4.83, 4.8);
  });
  it("steps show the equation with the numbers substituted", () => {
    const r = designFlexible({ W18: 5e6, reliability: 95, S0: 0.35, deltaPSI: 1.9, MR: 5000 });
    const s = r.steps.join("\n");
    expect(s).toMatch(/9\.36·log10\(5\.97\d\)/);
    expect(s).toMatch(/\(-1\.645\)×0\.35/);
    expect(s).toMatch(/2\.32·log10\(5000\)/);
    expect(s).toMatch(/W18 = 10\^6\.699\d = 5,000,/);
  });
});

describe("AASHTO 1993 layered design (App. H: a1 0.42, a2 0.14, a3 0.08, m 1.20 → published D1 8, D2 7, D3 11 in)", () => {
  const layered = { reliability: 95, S0: 0.35, MR: 5700, a1: 0.42, a2: 0.14, a3: 0.08, m2: 1.2, m3: 1.2, baseModulus: 30000, subbaseModulus: 11000 };
  it("with W18 16.0e6 / ΔPSI 1.89 throughout: D1 8.0, D2 7.0, D3 11.5 in (D3 needs 11.1 in; rounded UP to 0.5 in)", () => {
    const r = designFlexible({ ...layered, W18: 16.0e6, deltaPSI: 1.89 });
    expect(r.layers!.map((l) => l.D_in)).toEqual([8, 7, 11.5]);
    near(r.SN, 5.6, 0.01); // SN3 = 5.60 matches the printed 5.6
    expect(r.ok).toBe(true);
  });
  it("the printed D3 = 11 in follows from SN3 = 5.55 (W18 18.6e6, ΔPSI 2.1): (5.55 − 3.36 − 1.176)/0.096 = 10.5 → 11 rounded up", () => {
    // i.e. the source took SN3 from the total-traffic run; alternatively it rounded 11.1 in to the nearest inch (SN 5.59 vs 5.60)
    const r = designFlexible({ ...layered, W18: 18.6e6, deltaPSI: 2.1, D1: 8, D2: 7 });
    expect(r.layers!.map((l) => l.D_in)).toEqual([8, 7, 11]);
  });
  it("check mode flags a short section and the minimum-thickness rule", () => {
    const r = designFlexible({ W18: 5e6, reliability: 95, S0: 0.35, deltaPSI: 1.9, MR: 5000, D1: 3, D2: 6, D3: 10 });
    near(r.SNprovided!, 0.44 * 3 + 0.14 * 6 + 0.11 * 10, 1e-9);
    expect(r.checks.find((c) => c.name.startsWith("SN provided"))!.ok).toBe(false);
    expect(r.checks.find((c) => c.name.startsWith("Minimum asphalt"))!.ok).toBe(false); // 3.5 in for 2–7 million ESAL
  });
  it("SI input gives the same SN and reports mm", () => {
    const us = designFlexible({ W18: 5e6, reliability: 95, S0: 0.35, deltaPSI: 1.9, MR: 5000 });
    const si = designFlexible({ units: "SI", W18: 5e6, reliability: 95, S0: 0.35, deltaPSI: 1.9, MR: 5000 / PSI_PER_MPA });
    near(si.SN, us.SN, 1e-4);
    const d = designFlexible({ units: "SI", W18: 5e6, reliability: 95, S0: 0.35, deltaPSI: 1.9, MR: 5000 / PSI_PER_MPA, D1: 150, D2: 250 });
    expect(d.layers![2].D_mm % 10).toBeCloseTo(0, 6); // solved subbase rounded up to 10 mm
    expect(d.checks.find((c) => c.name.startsWith("SN provided"))!.ok).toBe(true);
  });
  it("rejects bad inputs with clear messages", () => {
    expect(() => designFlexible({ W18: 0, reliability: 95, MR: 5000 })).toThrow(/W18/);
    expect(() => designFlexible({ W18: 1e6, reliability: 95, CBR: 0 })).toThrow(/CBR must be greater than 0/);
    expect(() => designFlexible({ W18: 1e6, reliability: 95, MR: 5000, deltaPSI: 3 })).toThrow(/ΔPSI/);
    expect(() => designFlexible({ W18: 1e6, reliability: 95 })).toThrow(/MR/);
  });
});

describe("Material correlations and AASHTO tables", () => {
  it("MR = 1500·CBR psi (warn above CBR 10) and IRC:37-2018", () => {
    expect(mrFromCBR(5).MR_psi).toBe(7500);
    expect(mrFromCBR(12).notes.join(" ")).toMatch(/CBR ≤ 10/);
    near(mrFromCBR(4, "irc37").MR_MPa, 40, 1e-9);
    near(mrFromCBR(8, "irc37").MR_MPa, 17.6 * 8 ** 0.64, 1e-9);
  });
  it("layer coefficient correlations (a2 = 0.14 at EBS ≈ 30,000 psi; a3 = 0.11 at ESB ≈ 15,000 psi)", () => {
    near(baseCoefficient(30000), 0.138, 0.002); near(subbaseCoefficient(15000), 0.109, 0.002);
  });
  it("drainage m (Table 2.4) and Cd (Table 2.5): range and midpoint", () => {
    expect(drainageCoefficientM("good", "1_to_5")).toMatchObject({ max: 1.25, min: 1.15 }); near(drainageCoefficientM("good", "1_to_5").value, 1.2, 1e-9);
    expect(drainageCoefficientM("very_poor", "over_25").value).toBe(0.4);
    near(drainageCoefficientCd("fair", "5_to_25").value, 0.95, 1e-9);
    expect(drainageCoefficientCd("excellent", "under_1")).toMatchObject({ max: 1.25, min: 1.2 });
  });
  it("AASHTO minimum thicknesses by ESAL", () => {
    expect(aashtoMinimumThickness(50000)).toMatchObject({ ac: 1.0, base: 4 });
    expect(aashtoMinimumThickness(1e6)).toMatchObject({ ac: 3.0, base: 6 });
    expect(aashtoMinimumThickness(8e6)).toMatchObject({ ac: 4.0, base: 6 });
  });
  it("J guidance (FHWA Table C-4)", () => {
    expect(loadTransferJ("JPCP_JRCP", "asphalt", true).value).toBe(3.2);
    expect(loadTransferJ("JPCP_JRCP", "tied_pcc", false)).toMatchObject({ min: 3.6, max: 4.2 });
    expect(loadTransferJ("CRCP", "tied_pcc")).toMatchObject({ min: 2.3, max: 2.9 });
  });
});

describe("AASHTO 1993 rigid slab thickness (published examples; tolerance 0.05 in to the equation, 0.1 in to the printed D)", () => {
  const rigid = (o: Parameters<typeof designRigid>[0], eq: number, pub: number) => { const r = designRigid(o); near(r.D_required_in, eq, 0.05); near(r.D_required_in, pub, 0.1); return r; };
  it("AASHTO Fig 3.7 (Huang Ex. 12.6): k 72, Ec 5e6, S'c 650, J 3.2, Cd 1.0, ΔPSI 1.7, R 95, S0 0.29, W18 5.1e6 → 9.75 [9.72]", () => {
    const r = rigid({ W18: 5.1e6, reliability: 95, S0: 0.29, deltaPSI: 1.7, Sc: 650, Ec: 5e6, k: 72, J: 3.2, Cd: 1.0 }, 9.72, 9.75);
    expect(r.D_in).toBe(10); // rounded up to 0.5 in
    expect(r.steps.join("\n")).toMatch(/7\.35·log10\(10\.7\d\d\)/);
  });
  it("FHWA NHI-05-037 Ch. 6: W18 16.4e6, R 90, S0 0.35, ΔPSI 1.9, pt 2.5, S'c 690, Ec 4.4e6, J 2.8, Cd 1.0, k 38 → 10.4 [10.38]", () => {
    rigid({ W18: 16.4e6, reliability: 90, S0: 0.35, deltaPSI: 1.9, pt: 2.5, Sc: 690, Ec: 4.4e6, J: 2.8, Cd: 1.0, k: 38 }, 10.38, 10.4);
  });
  it("AASHTO App. I: Ec 4.2e6, S'c 578, Cd 1.05, J 2.8, k 105, R 95, S0 0.29, ΔPSI 2.0, W18 = 142,800·(1.03^25 − 1)/0.03 → 9.0 (pt 2.5 assumed)", () => {
    const W18 = 142800 * growthFactor(3, 25);
    close(W18, 5.21e6, 0.001);
    rigid({ W18, reliability: 95, S0: 0.29, deltaPSI: 2.0, pt: 2.5, Sc: 578, Ec: 4.2e6, J: 2.8, Cd: 1.05, k: 105 }, 9.0, 9.0);
  });
  it("SI input gives the same slab; k = MR/19.4 with no subbase", () => {
    const si = designRigid({ units: "SI", W18: 5.1e6, reliability: 95, S0: 0.29, deltaPSI: 1.7, Sc: 650 / PSI_PER_MPA, Ec: 5e6 / PSI_PER_MPA, k: 72 * MPA_PER_M_PER_PCI, J: 3.2, Cd: 1 });
    near(si.D_required_in, 9.72, 0.05);
    expect(si.D_mm % 10).toBeCloseTo(0, 6);
    near(designRigid({ W18: 5e6, reliability: 90, Sc: 650, Ec: 4e6, MR: 5000, J: 3.2 }).k_pci, 5000 / 19.4, 1e-9);
  });
});

describe("Cumulative design traffic (ESAL / msa)", () => {
  it("IRC:37-2018 Annex II.3: A 2500 (one direction), r 6 %, D·L 0.75, F 5.2 → 131 msa (20 yr), 46.9 msa (10 yr)", () => {
    const base = { method: "IRC" as const, dailyVehicles: 2500, factor: 5.2, growthRate: 6, ircLaneCase: "dual_2_lane" as const, directional: 1 };
    near(cumulativeESAL({ ...base, designLife: 20 }).msa, 131, 0.5);
    near(cumulativeESAL({ ...base, designLife: 10 }).msa, 46.9, 0.05);
  });
  it("AASHTO App. H: 2.5e6 two-way first-year ESAL × 0.5 × 0.8, 3 % for 15 years → 18.6e6", () => {
    const r = cumulativeESAL({ method: "AASHTO", firstYearESAL: 2.5e6, lane: 0.8, growthRate: 3, designLife: 15 });
    near(r.designLaneFirstYearESAL, 1.0e6, 1); close(r.cumulativeESAL, 18.6e6, 0.001);
  });
  it("LGED App. G: 70 trucks, 20 buses, 73 minibuses, 8 % for 10 yr → 370,132 / 52,876 / 77,199 = 500,207; ×2 single lane = 1.00 msa", () => {
    const classes = [{ name: "truck", perDay: 70 }, { name: "bus", perDay: 20 }, { name: "minibus", perDay: 73 }];
    const r = cumulativeESAL({ method: "LGED", classes, growthRate: 8, designLife: 10 });
    [370132, 52876, 77199].forEach((v, i) => near(r.classes[i].cumulative, v, 1)); // exact to the unit
    near(r.cumulativeESAL, 500207, 1);
    near(cumulativeESAL({ method: "LGED", classes, growthRate: 8, designLife: 10, singleLane: true }).msa, 1.0, 0.001);
  });
  it("LGED Ex-1 and Ex-2: exact 1,189,709 and 2,926,974 (printed 1,190,812 and 2,929,125 use growth factors rounded to 14.50 and 21.4)", () => {
    const e1 = cumulativeESAL({ method: "LGED", dailyVehicles: 100, factor: 2.25, growthRate: 8, designLife: 10 }).cumulativeESAL;
    near(e1, 1189709, 1); close(e1, 1190812, 0.001);
    const e2 = cumulativeESAL({ method: "LGED", dailyVehicles: 300, factor: 1.25, growthRate: 10, designLife: 12 }).cumulativeESAL;
    near(e2, 2926974, 1); close(e2, 2929125, 0.001);
  });
  it("RHD App. 2: 20 large + 150 medium + 50 small trucks + 100 large buses → 939 ESA/day, 342,735/yr, × 41.0 (Regional) ≈ 14.05 msa", () => {
    // the example applies the daily ESA directly (no 0.5 split), so D = 1 here
    const classes = [{ name: "large truck", perDay: 20 }, { name: "medium truck", perDay: 150 }, { name: "small truck", perDay: 50 }, { name: "large bus", perDay: 100 }, { name: "car", perDay: 500 }];
    const r = cumulativeESAL({ method: "RHD", roadClass: "Regional", classes, directional: 1 });
    near(r.dailyESA, 939, 1e-9); near(r.firstYearAnnualESAL, 342735, 1e-6);
    near(r.msa, 14.05, 0.01); close(r.cumulativeESAL, 342735 * 41.0, 0.0002);
    expect(cumulativeESAL({ method: "RHD", classes }).directional).toBe(0.5); // default single carriageway split
  });
  it("RHD Table 4 cumulative factors agree with the formula: 57.27 → 57.3, 40.99 → 41.0", () => {
    near(growthFactor(10, 20), RHD_CUMULATIVE.National.factor, 0.05); near(growthFactor(7, 20), RHD_CUMULATIVE.Regional.factor, 0.05);
  });
  it("zero growth, traffic at opening and IRC indicative VDF", () => {
    expect(growthFactor(0, 15)).toBe(15);
    const a = cumulativeESAL({ dailyVehicles: 100, factor: 1, growthRate: 5, designLife: 10, yearsToOpening: 2 });
    close(a.dailyESA, 100 * 1.05 ** 2, 1e-12);
    expect(ircIndicativeVDF(1500).vdf).toBe(5.0); expect(ircIndicativeVDF(100, "hilly").vdf).toBe(0.6);
    expect(() => cumulativeESAL({ classes: [{ name: "FHWA 9", perDay: 10 }], growthRate: 2, designLife: 20 })).toThrow(/No equivalence factor/);
  });
  it("AASHTO flexible LEF equation reproduces AASHTO Table D.4 (SN 5, pt 2.5); 4th-power approximation", () => {
    near(aashtoFlexibleLEF(10, "single"), 0.088, 0.001); near(aashtoFlexibleLEF(16, "single"), 0.623, 0.001);
    near(aashtoFlexibleLEF(18, "single"), 1.0, 1e-9); near(aashtoFlexibleLEF(20, "single"), 1.51, 0.005);
    near(aashtoFlexibleLEF(30, "single"), 7.0, 0.03); near(aashtoFlexibleLEF(30, "single", 1), 10.3, 0.01);
    near(aashtoFlexibleLEF(32, "tandem"), 0.857, 0.001); near(aashtoFlexibleLEF(48, "tridem"), 1.033, 0.001);
    expect(lefFourthPower(18)).toBe(1); near(lefFourthPower(36), 16, 1e-12);
    const r = cumulativeESAL({ classes: [{ name: "3-axle", perDay: 100, axles: [{ type: "single", load: 10 }, { type: "tandem", load: 32 }] }], axleLoadUnit: "kip", growthRate: 0, designLife: 1 });
    near(r.classes[0].factor, 0.0877 + 0.857, 0.001);
  });
});

describe("Bangladesh RHD 2005 catalogue (Table 5)", () => {
  it("Appendix 2: Regional road, CBR 3 %, 14 msa → 40 + 90 mm (130 DBS), 250 base Type I, 200 sub-base, 300 improved subgrade", () => {
    const r = rhdFlexibleDesign({ msa: 14, subgradeCBR: 3, roadClass: "Regional" });
    expect(r.layers.map((l) => l.thickness_mm)).toEqual([40, 90, 250, 200, 300]);
    expect(r.asphaltTotal_mm).toBe(130); expect(r.ok).toBe(true);
  });
  it("Table 6 option and the improved-subgrade conflict", () => {
    expect(rhdImprovedSubgrade(3, "table6").thickness).toBe(150);
    expect(rhdImprovedSubgrade(2, "table6").thickness).toBe(250);
    expect(rhdImprovedSubgrade(4).thickness).toBe(250);
    expect(rhdImprovedSubgrade(5).thickness).toBe(200); expect(rhdImprovedSubgrade(5, "table6").thickness).toBe(0);
    expect(rhdImprovedSubgrade(1.5).thickness).toBeNull();
  });
  it("band boundaries use the higher band; ≥ 30 msa has no granular base; > 80 msa is outside the catalogue", () => {
    expect(rhdFlexibleDesign({ msa: 15, subgradeCBR: 5 }).layers[1].thickness_mm).toBe(95);
    expect(rhdFlexibleDesign({ msa: 11, subgradeCBR: 5, baseType: "II" }).layers[2].thickness_mm).toBe(300);
    const hi = rhdFlexibleDesign({ msa: 30, subgradeCBR: 10 });
    expect(hi.layers[2].thickness_mm).toBeNull(); expect(hi.ok).toBe(false); expect(hi.layers[3].thickness_mm).toBe(150);
    expect(rhdFlexibleDesign({ msa: 80, subgradeCBR: 30 }).layers.map((l) => l.thickness_mm)).toEqual([40, 155, null, 0, 0]);
    expect(() => rhdFlexibleDesign({ msa: 81, subgradeCBR: 5 })).toThrow(/above the RHD 2005 catalogue limit/);
  });
});

describe("pavement tools", () => {
  const tool = (n: string) => PAVEMENT_TOOLS.find((t) => t.name === n)!;
  it("four transport tools with portable JSON schemas", () => {
    expect(PAVEMENT_TOOLS.map((t) => t.name)).toEqual(["pavement_flexible_aashto", "pavement_rigid_aashto", "traffic_esal", "pavement_rhd_catalogue"]);
    for (const t of PAVEMENT_TOOLS) {
      expect(t.category).toBe("transport");
      const js = JSON.stringify(toolJsonSchema(t, "gemini"));
      expect(js).not.toMatch(/prefixItems/);
      expect(JSON.stringify(toolJsonSchema(t, "openai"))).not.toMatch(/"items":\[/);
    }
  });
  it("run through zod and return steps/table displays with a summary", async () => {
    const f = await tool("pavement_flexible_aashto").run(tool("pavement_flexible_aashto").schema.parse({ W18: 5e6, reliability: 95, S0: 0.35, deltaPSI: 1.9, MR: 5000 }));
    expect(f.display?.kind).toBe("steps"); expect(f.summary).toMatch(/SN = 4\.98 in.*AASHTO|AASHTO 1993 flexible: required SN = 4\.98/);
    const r = await tool("pavement_rigid_aashto").run(tool("pavement_rigid_aashto").schema.parse({ W18: 5.1e6, reliability: 95, S0: 0.29, deltaPSI: 1.7, Sc: 650, Ec: 5e6, k: 72, J: 3.2, Cd: 1 }));
    expect(r.summary).toMatch(/use 10\.0 in \(254 mm\)/);
    const t = await tool("traffic_esal").run(tool("traffic_esal").schema.parse({ method: "RHD", roadClass: "Regional", classes: [{ name: "Large truck", perDay: 20 }], directional: 1 }));
    expect(t.summary).toMatch(/msa/);
    const c = await tool("pavement_rhd_catalogue").run(tool("pavement_rhd_catalogue").schema.parse({ msa: 14, subgradeCBR: 3 }));
    expect(c.display?.kind).toBe("table"); expect(c.summary).toMatch(/total 880 mm/);
    expect(tool("pavement_flexible_aashto").schema.safeParse({ W18: 1e6, reliability: 40, MR: 5000 }).success).toBe(false);
  });
});
