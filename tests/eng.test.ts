import { describe, it, expect } from "vitest";
import { analyzeBeam, rectI } from "@/lib/eng/beam";
import { convert } from "@/lib/eng/units";
import { designRcBeam, designOneWaySlab, designIsolatedFooting, tauC_IS } from "@/lib/eng/rc";
import { designColumn, perimeterBars, sectionResponse } from "@/lib/eng/column";
import { isSteelStress, strainLimits, phiTied } from "@/lib/eng/rcCode";
import { terzaghiFactors, bearingCapacity } from "@/lib/eng/soil";
import { concreteMaterials, rebarKgPerM, brickMasonry } from "@/lib/eng/quantity";
import { averageEndArea, prismoidal, gridCutFill } from "@/lib/eng/earthwork";
import { designSteelBeam } from "@/lib/eng/steel";
import { searchCodes, COUNTRY_ORDER, countryOf } from "@/lib/eng/codes";
import { evaluate } from "@/lib/eng/calc";
import { runTool, selectToolsForText, TOOLS, toolJsonSchema } from "@/lib/tools";
import { recommendModel, type Hardware } from "@/lib/local";
import { stripLeakedReasoning, compactHistory, friendlyError } from "@/lib/ai/agent";
import { planLayout, planBuilding, dhakaRules2025 } from "@/lib/eng/layout";
import { toDxf } from "@/lib/drawing/dxf";
import { toSvg } from "@/lib/drawing/svg";
import { beamSection, floorPlan, footingDrawing } from "@/lib/drawing/templates";

const close = (a: number, b: number, tol = 1e-2) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("beam analysis", () => {
  it("simply supported UDL: R = wL/2, Mmax = wL²/8, δ = 5wL⁴/384EI", () => {
    const E = 200000, I = rectI(300, 600);
    const r = analyzeBeam({ span: 6, support: "simply_supported", loads: [{ type: "udl", magnitude: 10 }], E, I });
    close(r.reactions.RA, 30); close(r.reactions.RB, 30);
    close(r.maxMomentPositive.value, 45); close(r.maxMomentPositive.x, 3);
    close(Math.abs(r.maxShear.value), 30);
    const EI = E * 1e6 * I * 1e-12;
    const expected = (5 * 10e3 * 6 ** 4) / (384 * EI) * 1000;
    close(r.maxDeflection!.value, expected, 0.02);
  });
  it("simply supported point load at midspan: M = PL/4", () => {
    const r = analyzeBeam({ span: 4, support: "simply_supported", loads: [{ type: "point", magnitude: 20, position: 2 }] });
    close(r.reactions.RA, 10); close(r.maxMomentPositive.value, 20);
  });
  it("cantilever UDL: MA = -wL²/2", () => {
    const r = analyzeBeam({ span: 3, support: "cantilever", loads: [{ type: "udl", magnitude: 5 }] });
    close(r.reactions.RA, 15); close(r.reactions.MA, -22.5); close(r.maxMomentNegative.value, -22.5);
  });
  it("fixed-fixed UDL: end moments wL²/12, midspan wL²/24", () => {
    const r = analyzeBeam({ span: 6, support: "fixed_fixed", loads: [{ type: "udl", magnitude: 10 }] });
    close(r.reactions.MA, -30); close(r.reactions.MB, -30); close(r.maxMomentPositive.value, 15, 0.02);
  });
  it("fixed-fixed midspan point load: PL/8", () => {
    const r = analyzeBeam({ span: 4, support: "fixed_fixed", loads: [{ type: "point", magnitude: 20, position: 2 }] });
    close(r.reactions.MA, -10); close(r.maxMomentPositive.value, 10, 0.02);
  });
  it("fixed-fixed asymmetric point load: MA = Pab²/L², RA = Pb²(3a+b)/L³", () => {
    const r = analyzeBeam({ span: 4, support: "fixed_fixed", loads: [{ type: "point", magnitude: 20, position: 1 }] });
    close(r.reactions.MA, -11.25); close(r.reactions.MB, -3.75); close(r.reactions.RA, 16.875); close(r.reactions.RB, 3.125);
  });
  it("propped cantilever UDL: MA = -wL²/8, RB = 3wL/8", () => {
    const r = analyzeBeam({ span: 8, support: "propped_cantilever", loads: [{ type: "udl", magnitude: 10 }] });
    close(r.reactions.MA, -80, 0.02); close(r.reactions.RB, 30, 0.02);
  });
});

describe("units", () => {
  it("converts common units", () => {
    close(convert(1, "m", "ft").value, 3.28084);
    close(convert(1, "MPa", "psi").value, 145.038);
    close(convert(100, "C", "F").value, 212);
    close(convert(1, "kN.m", "kip.ft").value, 0.73756);
    close(convert(1, "kN/m2", "psf").value, 20.885);
    close(convert(5, "katha", "ft2").value, 3600, 0.01); close(convert(1, "bigha", "katha").value, 20, 0.01); close(convert(100, "cft", "m3").value, 2.8317, 0.01);
  });
  it("rejects cross-category", () => { expect(() => convert(1, "m", "kg")).toThrow(); });
});

describe("RC design", () => {
  it("IS 456 singly reinforced beam matches the Annex G closed form", () => {
    const r = designRcBeam({ code: "IS456", b: 300, D: 500, cover: 25, fck: 20, fy: 415, Mu: 120, Vu: 100 });
    expect(r.singlyReinforced).toBe(true);
    // IS 456 G-1.1(b): Ast = 0.5·fck/fy·[1 − √(1 − 4.6·Mu/(fck·b·d²))]·b·d, d = 500 − 25 − 8 − 8 = 459 → 827.9 mm²
    close(r.d, 459, 0.001);
    close(r.AstRequired, 827.9, 0.002);
    expect(r.shear!.stirrupSpacing).toBeLessThanOrEqual(300);
  });
  it("compression steel stress follows SP-16 Table F (Fe415 and Fe500, d'/d = 0.05 to 0.20)", () => {
    const tableF: [number, number, number][] = [[415, 0.05, 355], [415, 0.1, 353], [415, 0.15, 342], [415, 0.2, 329], [500, 0.05, 424], [500, 0.1, 412], [500, 0.15, 395], [500, 0.2, 370]];
    for (const [fy, r, fsc] of tableF) {
      const k = fy === 415 ? 0.48 : 0.46;
      close(isSteelStress(fy, (0.0035 * (k - r)) / k), fsc, 0.006);
    }
  });
  it("IS 456 doubly reinforced beam uses fsc from strain", () => {
    const r = designRcBeam({ code: "IS456", b: 250, D: 450, fck: 20, fy: 415, Mu: 250 });
    expect(r.singlyReinforced).toBe(false);
    expect(r.steps.join(" ")).toMatch(/fsc = 3[45]\d MPa/);
    // equilibrium: Mu,lim + Asc·(fsc − 0.446fck)·(d − d') = Mu
    expect(r.AscRequired).toBeGreaterThan(0);
  });
  it("IS 456 Table 19 shear strength τc", () => {
    const t19: [number, number, number][] = [[20, 0.25, 0.36], [20, 0.5, 0.48], [20, 0.75, 0.56], [20, 1.0, 0.62], [20, 1.5, 0.72], [20, 2.0, 0.79], [25, 0.25, 0.36], [25, 0.5, 0.49], [25, 1.0, 0.64], [25, 2.0, 0.82], [25, 3.0, 0.92], [30, 1.0, 0.66]];
    for (const [f, p, t] of t19) expect(Math.abs(tauC_IS(f, p) - t)).toBeLessThanOrEqual(0.015);
  });
  it("BNBC/ACI beam: Whitney block equilibrium, tension-controlled, stirrup yield capped at 420 MPa", () => {
    const r = designRcBeam({ code: "BNBC2020", b: 300, D: 500, fck: 25, fy: 500, Mu: 180, Vu: 150 });
    const a = (r.AstRequired * 500) / (0.85 * 25 * 300);
    close((0.9 * r.AstRequired * 500 * (r.d - a / 2)) / 1e6, 180, 0.002);
    expect(r.steps.join(" ")).toMatch(/fyt = 420 MPa/);
    const deep = designRcBeam({ code: "BNBC2020", b: 250, D: 400, fck: 25, fy: 420, Mu: 260 });
    expect(deep.singlyReinforced).toBe(false);
    expect(deep.AscRequired).toBeGreaterThan(0);
  });
  it("ACI 318-19 uses εty + 0.003 for tension control; BNBC (ACI 318-11) uses 0.005", () => {
    expect(strainLimits("ACI318", 520).tension).toBeCloseTo(0.0056, 4);
    expect(strainLimits("BNBC2020", 520).tension).toBe(0.005);
    expect(phiTied("BNBC2020", 420, 0.0021)).toBeCloseTo(0.65, 2);
    expect(phiTied("BNBC2020", 420, 0.005)).toBe(0.9);
  });
  it("column interaction points agree with an independent strain-compatibility analysis (concreteproperties)", () => {
    // reference values computed with the open-source concreteproperties library for the same bar positions
    const aci = { b: 400, h: 400, bars: perimeterBars(400, 400, 12, 25, 40, 10) };
    const r1 = sectionResponse("ACI318", aci, 35, 420, "x", 240);
    close(r1.P / 1e3, 2739.6, 0.002); close(r1.M / 1e6, 417.8, 0.002);
    const is = { b: 300, h: 500, bars: perimeterBars(300, 500, 10, 20, 40, 8) };
    const r2 = sectionResponse("IS456", is, 25, 500, "x", 300);
    close(r2.P / 1e3, 1021.3, 0.003); close(r2.M / 1e6, 246.5, 0.003);
  });
  it("column design: biaxial BNBC column, slender columns get magnified moments, sway columns are refused", () => {
    const r = designColumn({ code: "BNBC2020", b: 300, h: 450, fc: 25, fy: 420, Pu: 1500, Mux: 120, Muy: 40, lu: 3000, curvature: "double", endMomentRatio: 0.5 });
    expect(r.ok).toBe(true);
    // with the conservative default (single curvature, equal end moments) the same column is too slender about y:
    const tooSlender = designColumn({ code: "BNBC2020", b: 300, h: 450, fc: 25, fy: 420, Pu: 1500, Mux: 120, Muy: 40, lu: 3000 });
    expect(tooSlender.ok).toBe(false);
    expect(tooSlender.checks.some((c) => /Second-order/.test(c.name) && !c.ok)).toBe(true);
    expect(tooSlender.checks.filter((c) => !c.ok).every((c) => /Second-order/.test(c.name))).toBe(true); // only the size check fails
    expect(tooSlender.bars.percent).toBeLessThanOrEqual(6); // strength is met within the BNBC 6% maximum
    expect(r.capacity.biaxialRatio!).toBeLessThanOrEqual(1);
    // hand check: Ec = 4700√28 = 24 870 MPa, Ig = 300⁴/12
    const slender = designColumn({ code: "ACI318", b: 300, h: 300, fc: 28, fy: 420, Pu: 500, Mux: 40, lu: 3500, bars: { count: 8, dia: 20 } });
    // EI = min(0.4EcIg, 0.2EcIg + Es·Ise)/1.6 = 4.007e12 (Ise = 6 bars × 314 mm² × 90²) → Pc = 3228 kN, δns = 1.260
    expect(slender.steps.join(" ")).toMatch(/Pc = 322[78] kN, Cm = 1\.00, δns = 1\.26\d/);
    close(slender.designMoments.x, 1.2603 * 40, 0.004);
    const veryslender = designColumn({ code: "ACI318", b: 300, h: 300, fc: 28, fy: 420, Pu: 900, Mux: 40, lu: 4500, bars: { count: 8, dia: 20 } });
    expect(veryslender.checks.some((c) => /Second-order/.test(c.name) && !c.ok)).toBe(true); // δns = 2.42 > 1.4
    const sway = designColumn({ code: "BNBC2020", b: 300, h: 300, fc: 25, fy: 420, Pu: 800, Mux: 50, lu: 4000, braced: false, bars: { count: 8, dia: 20 } });
    expect(sway.checks.some((c) => /Sway/.test(c.name) && !c.ok)).toBe(true);
    const isCol = designColumn({ code: "IS456", b: 300, h: 400, fc: 25, fy: 500, Pu: 1500, lu: 3000 });
    expect(isCol.ok).toBe(true);
    expect(isCol.steps.join(" ")).toMatch(/e,min = 20\.0 mm/); // max(3000/500 + 400/30 = 19.3, 20)
    expect(isCol.bars.percent).toBeGreaterThanOrEqual(0.8);
  });
  it("one-way slab: BNBC minimum thickness table and brick-aggregate minimum steel", () => {
    const r = designOneWaySlab({ code: "BNBC2020", span: 3.6, liveLoad: 2, fck: 25, fy: 420, support: "one_end_continuous" });
    expect(r.thickness).toBe(150); // 3600/24
    const khoa = designOneWaySlab({ code: "BNBC2020", span: 3.6, liveLoad: 2, fck: 25, fy: 420, support: "one_end_continuous", brickAggregate: true });
    close(khoa.AstMin, 1.5 * 0.0018 * 1000 * 150, 0.001);
    const is = designOneWaySlab({ code: "IS456", span: 3.5, liveLoad: 3, fck: 20, fy: 415 });
    expect(is.deflectionCheck.ok).toBe(true);
    expect(is.mainBars).toMatch(/Ø10 @ \d+/);
  });
  it("isolated footing passes shear, development and bearing checks in every code", () => {
    for (const code of ["BNBC2020", "ACI318", "IS456"] as const) {
      const r = designIsolatedFooting({ code, columnB: 300, columnD: 400, deadLoad: 600, liveLoad: 200, safeBearingCapacity: 200, fck: 25, fy: 420 });
      expect(r.checks.every((c) => c.ok), code).toBe(true);
      expect(r.side).toBeGreaterThanOrEqual(2.1);
    }
  });
});

describe("soil", () => {
  it("Terzaghi factors φ=30°", () => {
    const f = terzaghiFactors(30);
    close(f.Nc, 37.2, 0.02); close(f.Nq, 22.5, 0.02); close(f.Ng, 19.7, 0.05);
  });
  it("bearing capacity strip footing", () => {
    const r = bearingCapacity({ cohesion: 10, frictionAngle: 30, unitWeight: 18, depth: 1.5, width: 2 });
    expect(r.ultimate).toBeGreaterThan(900);
    expect(r.safe).toBeLessThan(r.ultimate);
  });
});

describe("quantities", () => {
  it("M20 concrete per m³ ≈ 8 bags cement", () => {
    const r = concreteMaterials(1, "M20", 0);
    expect(r.cement.bags).toBeGreaterThanOrEqual(8);
    expect(r.cement.bags).toBeLessThanOrEqual(9);
  });
  it("100 cft of 1:2:4 without wastage: 22 cft cement (~18 bags), 44 cft sand, 88 cft chips", () => {
    const r = concreteMaterials(100, "1:2:4", 0, { unit: "cft", grade: "M20" });
    expect(r.ratio).toBe("1:2:4");
    expect(r.grade).toBe("M15");
    close(r.cement.cft, 22, 0.01); close(r.sand.cft, 44, 0.01); close(r.aggregate.cft, 88, 0.01);
    expect(r.cement.bags).toBe(18);
    expect(r.notes[0]).toMatch(/M20 is 1:1.5:3/);
  });
  it("ratio takes priority over grade in the tool", async () => {
    const out = await runTool("concrete_materials", { volume: 100, volumeUnit: "cft", ratio: "1:2:4", grade: "M20" });
    expect((out.result as { ratio: string }).ratio).toBe("1:2:4");
  });
  it("rebar 12 mm = 0.888 kg/m", () => { close(rebarKgPerM(12), 0.888, 0.01); });
  it("5 katha = 3600 sft exactly = 8.26 decimal", () => {
    expect(convert(5, "katha", "sqft").value).toBeCloseTo(3600, 6);
    close(convert(5, "katha", "decimal").value, 8.2645, 0.0001);
    expect(convert(1, "bigha", "katha").value).toBeCloseTo(20, 9);
  });
  it("India modular bricks ≈ 500 per m³", () => { close(brickMasonry(1, "india_modular").bricksPerM3, 500, 0.02); });
  it("Bangladesh standard bricks ≈ 11.5 per cft (default)", () => { close(brickMasonry(1).bricksPerCft, 11.52, 0.01); });
});

describe("house plans keep NBC minimum sizes", () => {
  it("5 katha (40 × 90 ft) two-storey house with garage and dining passes every check", () => {
    const r = planBuilding({ plot: { shape: "rectangular", width: 12.19, depth: 27.43 }, storeys: 2, bedrooms: 3, garage: true, dining: true } as Parameters<typeof planBuilding>[0]);
    expect(r.floors).toHaveLength(2);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe("BNBC 2020 planning rules and Dhaka 2025 by-laws", () => {
  it("habitable rooms must be 2.9 m wide under BNBC (2.4 m under NBC India)", () => {
    const rooms = [{ name: "Bedroom", width: 2.6, length: 4 }];
    const bnbc = planLayout({ plotWidth: 12, plotDepth: 15, rooms });
    expect(bnbc.checks.find((c) => /Bedroom/.test(c.name))!.ok).toBe(false);
    const nbc = planLayout({ plotWidth: 12, plotDepth: 15, rooms, standard: "NBC2016" });
    expect(nbc.checks.find((c) => /Bedroom/.test(c.name))!.ok).toBe(true);
  });
  it("Dhaka 2025: setbacks by storeys, coverage by plot size, FAR by road width", () => {
    expect(dhakaRules2025(334.5, 6, 6)).toMatchObject({ setback: { front: 1.5, side: 1.0, rear: 1.25 }, maxCoverage: 62.5, farByRoad: 3.25 });
    expect(dhakaRules2025(120, 9, 3)).toMatchObject({ setback: { front: 3.0, side: 1.25, rear: 2.0 }, maxCoverage: 70, farByRoad: 1.75 });
    expect(dhakaRules2025(1500, 12, 24)).toMatchObject({ setback: { side: 3.0, rear: 3.0 }, maxCoverage: 45, farByRoad: 4.75 });
  });
});

describe("tool routing", () => {
  const names = (q: string) => selectToolsForText(q).map((t) => t.name);
  it("routes common Bangladeshi questions to the right tools with a small tool set", () => {
    expect(names("What is the total weight of 20 pieces of 12 mm rod, each 40 ft long?")).toContain("rebar_schedule");
    expect(names("How many bags of cement for 100 cft of 1:2:4 with stone chips?")).toContain("concrete_materials");
    expect(names("5 katha plot e 2 tola bari")).toContain("plan_building");
    expect(names("১০০ সিএফটি ঢালাইয়ে কত বস্তা সিমেন্ট লাগবে?")).toContain("concrete_materials");
    expect(names("৫ কাঠা জমিতে বাড়ির নকশা")).toContain("plan_building");
    expect(names("How many bags of cement for 100 cft of 1:2:4?").length).toBeLessThan(TOOLS.length / 2);
  });
});

describe("earthwork", () => {
  it("average end area & prismoidal", () => {
    close(averageEndArea([10, 20, 30], [10, 10]).volume, 400);
    close(prismoidal([10, 20, 30], 10).volume, 400);
  });
  it("grid cut/fill", () => {
    const r = gridCutFill([[10, 10], [10, 10]], [[11, 11], [11, 11]], 5);
    close(r.fill, 25); close(r.cut, 0);
  });
});

describe("steel", () => {
  it("cantilever ISMB 300 (IS 808:2021): Md = Zp·fy/γm0 = 154.8, deflection 26.7 mm just fails L/150", () => {
    const r = designSteelBeam({ span: 4, support: "cantilever", factoredUDL: 5, factoredPointLoad: 15, serviceUDL: 5, servicePointLoad: 15, section: "ISMB 300" });
    close(r.Mu, 100); close(r.Vu, 35);
    const c = r.candidates[0];
    close(c.momentCapacity, (681e3 * 250) / 1.1 / 1e6, 0.001); close(c.deflection!, 26.7, 0.005); expect(c.deflectionOk).toBe(false); expect(c.ok).toBe(false);
  });
  it("selects a section for 6 m beam 30 kN/m factored", () => {
    const r = designSteelBeam({ span: 6, factoredUDL: 30, serviceUDL: 20 });
    expect(r.recommended).toBeDefined();
    expect(r.recommended!.utilization).toBeLessThanOrEqual(1);
  });
});

describe("codes", () => {
  it("country ordering and filters", () => {
    expect(COUNTRY_ORDER[0]).toBe("Bangladesh"); expect(countryOf("BNBC 2020 Part 6")).toBe("Bangladesh"); expect(countryOf("NBC 2016 Part 3")).toBe("India"); expect(countryOf("NBC 105:2020 (Nepal)")).toBe("Nepal"); expect(countryOf("BCP-SP 2021 (Pakistan)")).toBe("Pakistan");
    expect(searchCodes("seismic zone", { country: "Pakistan" })[0].id).toBe("bcp-seismic-zones");
    expect(searchCodes("column size rules of thumb", { country: "Nepal" })[0].id).toBe("nbc205");
  });
  it("finds BNBC seismic zone and GB stirrup clauses", () => {
    expect(searchCodes("bangladesh seismic zone dhaka")[0].id).toBe("bnbc-2.5");
    expect(searchCodes("china stirrup spacing beam")[0].id).toBe("gb50010-9.2");
  });
  it("finds minimum steel clause", () => {
    const r = searchCodes("minimum steel beam", { code: "IS 456" });
    expect(r[0].id).toBe("is456-26.5.1.1");
  });
});

describe("drawing", () => {
  it("DXF and SVG generation", () => {
    const d = beamSection({ b: 300, D: 500, bottomBars: { count: 4, dia: 20 }, topBars: { count: 2, dia: 12 }, stirrup: { dia: 8, spacing: 150 } });
    const dxf = toDxf(d);
    expect(dxf).toContain("AC1009");
    expect(dxf.trim().endsWith("EOF")).toBe(true);
    expect((dxf.match(/\nCIRCLE\n/g) ?? []).length).toBe(6);
    const svg = toSvg(d);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<circle");
    const fp = floorPlan({ rooms: [{ name: "Living", x: 0, y: 0, width: 4000, length: 5000, door: "S", window: "N" }, { name: "Bed", x: 4230, y: 0, width: 3000, length: 5000, door: "W" }] });
    expect(toDxf(fp)).toContain("ARC");
    const ft = footingDrawing({ side: 2000, depth: 450, columnB: 300, columnD: 400, bars: { dia: 16, spacing: 150 } });
    expect(toSvg(ft)).toContain("SECTION A-A");
  });
});

describe("calculator", () => {
  it("supports ** and ^ and functions", () => {
    close(evaluate("25 * 6 ** 2 / 8"), 112.5); close(evaluate("25*6^2/8"), 112.5); close(evaluate("sqrt(16)+sind(30)"), 4.5);
  });
});

describe("tool input normalization", () => {
  it("fixes near-miss keys and numeric strings", async () => {
    const r = await runTool("design_rc_beam", { b: "300", d: 500, FCK: 25, fy: 500, Mb: "112.5", code: "IS456" });
    expect(r.error).toBeUndefined();
    expect((r.result as { AstRequired: number }).AstRequired).toBeGreaterThan(500);
  });
  it("lists expected parameters on failure", async () => {
    const r = await runTool("design_rc_beam", { b: 300 });
    expect(r.error).toContain("Expected parameters");
    expect(r.error).toContain("Mu*");
  });
  it("normalizes union loads", async () => {
    const r = await runTool("analyze_beam", { span: "6", support: "simply_supported", loads: [{ type: "udl", Magnitude: "25" }] });
    expect(r.error).toBeUndefined();
    expect(r.summary).toContain("112.50");
  });
});

describe("local model selection by hardware", () => {
  const base: Hardware = { platform: "win32", arch: "x64", cpuModel: "x", cores: 8, ramGB: 16, gpu: { vendor: "none" } };
  it("no GPU, 16 GB → 4B", () => expect(recommendModel(base).id).toBe("qwen3.5-4b"));
  it("4–8 GB GPU → still 4B", () => expect(recommendModel({ ...base, gpu: { vendor: "nvidia", vramGB: 8 } }).id).toBe("qwen3.5-4b"));
  it("12 GB+ GPU and 16 GB RAM → 9B", () => expect(recommendModel({ ...base, gpu: { vendor: "nvidia", vramGB: 16 } }).id).toBe("qwen3.5-9b"));
  it("6 GB RAM laptop → 2B; 4 GB → 0.8B", () => { expect(recommendModel({ ...base, ramGB: 6 }).id).toBe("qwen3.5-2b"); expect(recommendModel({ ...base, ramGB: 4 }).id).toBe("qwen3.5-0.8b"); });
  it("Apple Silicon 32 GB → 9B, 16 GB → 4B", () => { expect(recommendModel({ ...base, platform: "darwin", ramGB: 32, gpu: { vendor: "apple", vramGB: 32 } }).id).toBe("qwen3.5-9b"); expect(recommendModel({ ...base, platform: "darwin", ramGB: 16, gpu: { vendor: "apple", vramGB: 16 } }).id).toBe("qwen3.5-4b"); });
});

describe("tool routing for local models", () => {
  it("beam prompt gets beam tools + core only", () => {
    const names = selectToolsForText("Design a simply supported RC beam 6 m span then draw the section").map((t) => t.name);
    expect(names).toContain("analyze_beam"); expect(names).toContain("design_rc_beam"); expect(names).toContain("draw_beam_section"); expect(names).toContain("calculate");
    expect(names).not.toContain("design_isolated_footing"); expect(names.length).toBeLessThan(TOOLS.length);
  });
  it("unmatched prompt falls back to all tools", () => { expect(selectToolsForText("hello there").length).toBe(TOOLS.length); });
});

describe("leaked reasoning filter", () => {
  it("removes think blocks and text before a stray closing tag", () => {
    expect(stripLeakedReasoning("The user wants X.\n</think>\n\n## Summary\nOK")).toBe("## Summary\nOK");
    expect(stripLeakedReasoning("<think>hmm</think>Answer")).toBe("Answer");
    expect(stripLeakedReasoning("Plain answer")).toBe("Plain answer");
  });
});

describe("space planning", () => {
  it("arranges a 2-bedroom house on a 10×12 m plot within setbacks and passes NBC minimums", () => {
    const r = planLayout({ plotWidth: 10, plotDepth: 12, setback: { front: 1.5, rear: 1.5, side: 1 }, rooms: [{ name: "Living", area: 20 }, { name: "Kitchen", area: 8 }, { name: "Bedroom 1", area: 14 }, { name: "Bedroom 2", area: 12 }, { name: "Bath", area: 3 }] });
    expect(r.rooms.filter((x) => !x.open).length).toBe(5);
    expect(r.checks.find((c) => c.name.startsWith("Fits"))!.ok).toBe(true);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    for (const room of r.rooms.filter((x) => !x.open)) { expect(room.x).toBeGreaterThanOrEqual(1000); expect(room.x + room.width).toBeLessThanOrEqual(9000); }
    expect(r.coveragePercent).toBeLessThan(80);
  });
  it("flags undersized rooms", () => {
    const r = planLayout({ plotWidth: 8, plotDepth: 8, rooms: [{ name: "Bedroom", width: 2, length: 3 }, { name: "Kitchen", area: 3 }] });
    expect(r.checks.filter((c) => !c.ok).length).toBeGreaterThanOrEqual(2);
  });
});

describe("building planner", () => {
  it("plans a 2-storey 3-bed house with garage on 12×15 m", () => {
    const r = planBuilding({ plot: { shape: "rectangular", width: 12, depth: 15 }, buildingType: "single_family", storeys: 2, bedrooms: 3, bathrooms: 2, garage: true, dining: true });
    expect(r.floors.length).toBe(2);
    expect(r.floors[0].layout.rooms.some((x) => x.name === "Garage")).toBe(true);
    expect(r.floors[1].layout.rooms.some((x) => /Bedroom/.test(x.name))).toBe(true);
    expect(r.floors[0].layout.rooms.some((x) => /Master/.test(x.name))).toBe(false);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.checks.filter((c) => c.name.includes("Fits")).every((c) => c.ok)).toBe(true);
    const s = r.summary as { far: number; coveragePercent: number };
    expect(s.coveragePercent).toBeLessThan(75); expect(s.far).toBeGreaterThan(0.5);
  });
  it("shop-house: shops on ground, dwelling above; irregular polygon plot handled", () => {
    const r = planBuilding({ plot: { shape: "polygon", points: [[0, 0], [14, 0], [13, 11], [1, 12]] }, buildingType: "shop_house", storeys: 2, shops: 3, bedrooms: 2 });
    expect(r.floors[0].layout.rooms.filter((x) => /Shop/.test(x.name)).length).toBe(3);
    expect((r.summary as { plotArea: number }).plotArea).toBeCloseTo(149.5, 6); // true (shoelace) area, not a bounding box
    // Every room lies inside the actual boundary.
    const poly = r.plot.geometry.points, inside = ([x, y]: [number, number]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    for (const f of r.floors) for (const room of f.layout.rooms) {
      const x0 = room.x / 1000 + r.plot.offset.x, y0 = room.y / 1000 + r.plot.offset.y, x1 = x0 + room.width / 1000, y1 = y0 + room.length / 1000;
      for (const c of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][]) expect(inside(c), `${f.floor} ${room.name}`).toBe(true);
    }
  });
});

describe("history compaction", () => {
  it("leaves short conversations untouched and compresses long ones", () => {
    const short = [{ role: "user" as const, parts: [{ type: "text" as const, text: "hi" }] }];
    expect(compactHistory(short)).toBe(short);
    const long = Array.from({ length: 60 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", parts: [{ type: "text" as const, text: "x".repeat(4000) + i }] }));
    const c = compactHistory(long, 24000);
    expect(c.length).toBeLessThan(long.length);
    expect(c[0].role).toBe("user");
    expect(JSON.stringify(c).length).toBeLessThan(24000 * 4 * 1.2);
    expect(c[c.length - 1]).toEqual(long[long.length - 1]);
  });
});

describe("tool schemas are portable across providers", () => {
  // Gemini and Groq reject draft-7 tuples (items: [...]) and prefixItems; Gemini also rejects non-string enums.
  const walk = (n: unknown, issues: string[], path: string) => {
    if (Array.isArray(n)) { n.forEach((x, i) => walk(x, issues, `${path}[${i}]`)); return; }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (Array.isArray(o.items)) issues.push(`${path}: tuple items`);
    if ("prefixItems" in o) issues.push(`${path}: prefixItems`);
    for (const [k, v] of Object.entries(o)) walk(v, issues, `${path}.${k}`);
  };
  for (const flavor of ["openai", "gemini", "anthropic"] as const) {
    it(`${flavor}: no tuple-style arrays in any tool`, () => {
      const issues: string[] = [];
      for (const t of TOOLS) walk(toolJsonSchema(t, flavor), issues, t.name);
      expect(issues).toEqual([]);
    });
  }
  it("gemini: enums are strings only", () => {
    const bad: string[] = [];
    const walkEnum = (n: unknown, p: string) => { if (Array.isArray(n)) return n.forEach((x, i) => walkEnum(x, `${p}[${i}]`)); if (!n || typeof n !== "object") return; const o = n as Record<string, unknown>; if (Array.isArray(o.enum) && o.enum.some((e) => typeof e !== "string")) bad.push(p); for (const [k, v] of Object.entries(o)) walkEnum(v, `${p}.${k}`); };
    for (const t of TOOLS) walkEnum(toolJsonSchema(t, "gemini"), t.name);
    expect(bad).toEqual([]);
  });
  it("coordinate pairs still validate as [x, y]", async () => {
    const r = await runTool("draw_custom", { title: "t", entities: [{ type: "polyline", points: [[0, 0], [100, 0], [100, 50]], closed: true }] });
    expect(r.error).toBeUndefined();
  });
});

describe("friendly provider errors", () => {
  it("unwraps nested JSON error messages", () => {
    const raw = '{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 400,\\n    \\"message\\": \\"schema must be a boolean or an object\\"\\n  }\\n}\\n","code":400}}';
    expect(friendlyError(raw, "Google Gemini")).toBe("Google Gemini: schema must be a boolean or an object");
  });
});

describe("house style: no em dashes in displayed text", () => {
  it("tidies prose but leaves code alone", async () => {
    const { tidyDashes } = await import("@/components/Markdown");
    expect(tidyDashes("Ast is 942 mm² — use 3 bars — ok")).toBe("Ast is 942 mm², use 3 bars, ok");
    expect(tidyDashes("run `npm ci -- --flag` then — done")).toBe("run `npm ci -- --flag` then, done");
  });
});

describe("footing depth is increased for flexure, not only shear (regression)", () => {
  it("300 × 400 column, DL 600 + LL 400 kN on 150 kPa designs instead of failing with a beam error", async () => {
    const { designIsolatedFooting } = await import("@/lib/eng/rc");
    const r = designIsolatedFooting({ code: "BNBC2020", columnB: 300, columnD: 400, deadLoad: 600, liveLoad: 400, safeBearingCapacity: 150, fck: 25, fy: 500 });
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.side).toBeGreaterThan(2.5);
    expect(r.depth).toBeGreaterThanOrEqual(425);
  });
});
