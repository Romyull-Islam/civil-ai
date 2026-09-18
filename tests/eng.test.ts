import { describe, it, expect } from "vitest";
import { analyzeBeam, rectI } from "@/lib/eng/beam";
import { convert } from "@/lib/eng/units";
import { designRcBeam, designRcColumn, designOneWaySlab, designIsolatedFooting, tauC_IS } from "@/lib/eng/rc";
import { terzaghiFactors, bearingCapacity } from "@/lib/eng/soil";
import { concreteMaterials, rebarKgPerM, brickMasonry } from "@/lib/eng/quantity";
import { averageEndArea, prismoidal, gridCutFill } from "@/lib/eng/earthwork";
import { designSteelBeam } from "@/lib/eng/steel";
import { searchCodes } from "@/lib/eng/codes";
import { evaluate } from "@/lib/eng/calc";
import { runTool, selectToolsForText, TOOLS } from "@/lib/tools";
import { recommendModel, type Hardware } from "@/lib/local";
import { stripLeakedReasoning, compactHistory } from "@/lib/ai/agent";
import { planLayout, planBuilding } from "@/lib/eng/layout";
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
  });
  it("rejects cross-category", () => { expect(() => convert(1, "m", "kg")).toThrow(); });
});

describe("RC design", () => {
  it("IS 456 singly reinforced beam", () => {
    const r = designRcBeam({ b: 300, D: 500, cover: 25, fck: 20, fy: 415, Mu: 120, Vu: 100 });
    expect(r.singlyReinforced).toBe(true);
    // verify Ast satisfies Mu = 0.87 fy Ast d (1 - fy Ast/(fck b d))
    const Ast = r.AstRequired, d = r.d;
    const M = 0.87 * 415 * Ast * d * (1 - (415 * Ast) / (20 * 300 * d)) / 1e6;
    close(M, 120, 0.02);
    expect(r.tensionBars.length).toBeGreaterThan(0);
    expect(r.shear!.stirrupSpacing).toBeLessThanOrEqual(300);
  });
  it("IS 456 doubly reinforced when Mu > Mu,lim", () => {
    const r = designRcBeam({ b: 250, D: 450, fck: 20, fy: 415, Mu: 250 });
    expect(r.singlyReinforced).toBe(false);
    expect(r.AscRequired).toBeGreaterThan(0);
  });
  it("ACI beam", () => {
    const r = designRcBeam({ code: "ACI318", b: 300, D: 550, cover: 40, fck: 28, fy: 420, Mu: 200, Vu: 150 });
    expect(r.AstRequired).toBeGreaterThan(r.AstMin);
    expect(r.checks.find((c) => c.name.includes("Tension"))!.ok).toBe(true);
  });
  it("tau_c matches IS 456 Table 19 (M20, pt=1%: 0.62)", () => { close(tauC_IS(20, 1.0), 0.62, 0.03); });
  it("column IS 456", () => {
    const r = designRcColumn({ b: 300, D: 400, fck: 25, fy: 500, Pu: 1500 });
    expect(r.steelPercent).toBeGreaterThanOrEqual(0.8);
    expect(r.capacity).toBeGreaterThanOrEqual(1500);
  });
  it("one-way slab", () => {
    const r = designOneWaySlab({ span: 3.5, liveLoad: 3, fck: 20, fy: 415 });
    expect(r.thickness).toBeGreaterThanOrEqual(120);
    expect(r.deflectionCheck.ok).toBe(true);
    expect(r.mainBars).toMatch(/Ø10 @ \d+/);
  });
  it("isolated footing", () => {
    const r = designIsolatedFooting({ columnB: 300, columnD: 400, serviceLoad: 800, safeBearingCapacity: 200, fck: 20, fy: 415 });
    expect(r.side).toBeGreaterThanOrEqual(2.1);
    expect(r.oneWayShear.ok && r.punchingShear.ok).toBe(true);
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
  it("rebar 12 mm = 0.888 kg/m", () => { close(rebarKgPerM(12), 0.888, 0.01); });
  it("bricks ≈ 500 per m³", () => { close(brickMasonry(1).bricksPerM3, 500, 0.02); });
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
  it("cantilever ISMB 300: Md 148.1, deflection ≈ 28 mm fails L/150", () => {
    const r = designSteelBeam({ span: 4, support: "cantilever", factoredUDL: 5, factoredPointLoad: 15, serviceUDL: 5, servicePointLoad: 15, section: "ISMB 300" });
    close(r.Mu, 100); close(r.Vu, 35);
    const c = r.candidates[0];
    close(c.momentCapacity, 148.1, 0.01); close(c.deflection!, 27.9, 0.02); expect(c.deflectionOk).toBe(false); expect(c.ok).toBe(false);
  });
  it("selects a section for 6 m beam 30 kN/m factored", () => {
    const r = designSteelBeam({ span: 6, factoredUDL: 30, serviceUDL: 20 });
    expect(r.recommended).toBeDefined();
    expect(r.recommended!.utilization).toBeLessThanOrEqual(1);
  });
});

describe("codes", () => {
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
    expect(r.notes.some((n) => /Irregular/.test(n))).toBe(true);
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
