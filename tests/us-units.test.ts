/**
 * US bars and US-unit inputs, and the flexural-capacity calculator. Expected values are hand-computed from the ACI 318
 * formulas (shown in each test); the SI and US runs of the same beam must agree.
 */
import { describe, it, expect } from "vitest";
import { runTool } from "@/lib/tools";
import { beamCapacity } from "@/lib/eng/rc";
import { US_BARS, usBar, areaOf } from "@/lib/eng/rebar";
import { usLabel, feetInches } from "@/lib/drawing/units";
import { toDxf } from "@/lib/drawing/dxf";

describe("US bars (ASTM A615 nominal areas)", () => {
  it("areas and diameters", () => {
    expect(US_BARS.map((b) => +(b.A / 645.16).toFixed(2))).toEqual([0.11, 0.2, 0.31, 0.44, 0.6, 0.79, 1.0, 1.27, 1.56]);
    expect(usBar(8).d).toBeCloseTo(25.4, 9);
    expect(usBar(15.875).no).toBe(5);
    expect(areaOf(usBar(5).d, "US")).toBeCloseTo(200, 0);
  });
  it("label conversion: spacings round down to 1/2 in, bar marks become #", () => {
    expect(usLabel("2-leg #3 @ 190 mm")).toBe('2-leg #3 @ 7"');
    expect(usLabel("Ø19.05 @ 300 C/C")).toBe('#6 @ 11 1/2" C/C');
    expect(feetInches(366)).toBe(`30'-6"`);
  });
});

describe("flexural capacity of a given beam", () => {
  it("ACI 318: b 300, d 500, 3 No. 25 (As 1530 mm²), f'c 28, fy 420 → a 90, c 105.9, εt 0.0112, Mn 292.4, φMn 263.1 kN·m", () => {
    const r = beamCapacity({ code: "ACI318", b: 300, d: 500, As: 1530, fck: 28, fy: 420 });
    expect(r.a).toBeCloseTo(90.0, 6);
    expect(r.c).toBeCloseTo(105.882, 3);
    expect(r.et).toBeCloseTo(0.011167, 5);
    expect(r.phi).toBe(0.9);
    expect(r.Mn).toBeCloseTo(292.383, 3);
    expect(r.phiMn).toBeCloseTo(263.145, 3);
    expect(r.AsMin).toBeCloseTo(500, 6); // max(0.25√28, 1.4)/420 × 300 × 500
    expect(r.ok).toBe(true);
    // the same beam given as bars: No. 25 = US #8 (0.79 in² = 510 mm²)
    expect(beamCapacity({ code: "ACI318", b: 300, d: 500, bars: { count: 3, dia: 8 }, barSystem: "US", fck: 28, fy: 420 }).As).toBeCloseTo(1529.0, 0);
  });
  it("US units: 12 × 17.5 in, 3 #9, 4000 psi, Grade 60 → a 4.41 in, Mn 229.4 kip-ft, φMn 206.5 kip-ft", async () => {
    // a = 3.00×60/(0.85×4×12) = 4.412 in; Mn = 3.00×60×(17.5 − 2.206)/12 = 229.4 kip-ft; εt = 0.0071 → φ = 0.90
    const out = await runTool("rc_beam_capacity", { units: "US", code: "ACI318", b: 12, d: 17.5, bars: { count: 3, dia: 9 }, fck: 4000, fy: 60 });
    expect(out.error).toBeUndefined();
    const r = out.result as { Mn: number; phiMn: number; a: number; phi: number };
    expect(r.a / 25.4).toBeCloseTo(4.412, 2);
    expect(r.Mn / 1.355818).toBeCloseTo(229.4, 0);
    expect(r.phiMn / 1.355818).toBeCloseTo(206.5, 0);
    expect(out.summary).toMatch(/206\.[45] kip-ft/);
  });
  it("over-reinforced ACI section: steel does not yield, φ drops, ductility check fails", () => {
    const r = beamCapacity({ code: "ACI318", b: 250, d: 400, As: 5000, fck: 25, fy: 420 });
    expect(r.et!).toBeLessThan(420 / 200000);
    expect(r.phi).toBe(0.65);
    expect(r.checks.find((c) => /Ductility/.test(c.name))?.ok).toBe(false);
  });
  it("IS 456: 230 × 450, Ast 942, M20, Fe415 → xu 205.4 mm < 216 mm, Mu,R 123.7 kN·m", () => {
    const r = beamCapacity({ code: "IS456", b: 230, d: 450, As: 942, fck: 20, fy: 415 });
    expect(r.c).toBeCloseTo(205.38, 1);
    expect(r.Mn).toBeCloseTo(123.71, 1);
  });
});

describe("US inputs give the same design as the SI inputs", () => {
  it("RC beam: #-bars, in² and inch drawings; As equals the SI run", async () => {
    const us = await runTool("design_rc_beam", { units: "US", code: "ACI318", b: 12, D: 20, fck: 4000, fy: 60, Mu: 118, Vu: 25 });
    const si = await runTool("design_rc_beam", { code: "ACI318", b: 12 * 25.4, D: 20 * 25.4, fck: 4000 * 0.00689476, fy: 60 * 6.89476, Mu: 118 * 1.355818, Vu: 25 * 4.448222, mainBarDia: 19.05, stirrupDia: 9.525 });
    expect((us.result as { AstRequired: number }).AstRequired).toBeCloseTo((si.result as { AstRequired: number }).AstRequired, 6);
    expect(us.summary).toMatch(/in²/);
    expect(us.summary).toMatch(/#\d/);
    expect(us.summary).not.toMatch(/Ø/);
    expect(us.drawing?.drawing.units).toBe("in");
    const dxf = toDxf(us.drawing!.drawing);
    expect(dxf).toMatch(/\$INSUNITS\s+70\s+1\b/);
    expect(dxf).toMatch(/#\d+ BOTTOM/);
  });
  it("column, slab, footing, steel and soil accept US units", async () => {
    const col = await runTool("design_rc_column", { units: "US", code: "ACI318", b: 16, D: 16, fck: 4000, fy: 60, Pu: 340, Mux: 60, Muy: 20, unsupportedLength: 12 });
    expect(col.error).toBeUndefined(); expect(col.summary).toMatch(/#\d/);
    const slab = await runTool("design_one_way_slab", { units: "US", code: "ACI318", span: 12, liveLoad: 40, fck: 4000, fy: 60, support: "one_end_continuous" });
    expect(slab.error).toBeUndefined(); expect(slab.summary).toMatch(/in/);
    const ftg = await runTool("design_isolated_footing", { units: "US", code: "ACI318", columnB: 16, columnD: 16, deadLoad: 150, liveLoad: 80, safeBearingCapacity: 3, fck: 4000, fy: 60 });
    expect(ftg.error).toBeUndefined(); expect(ftg.summary).toMatch(/'-/);
    const st = await runTool("design_steel_beam", { units: "US", code: "AISC", span: 24, factoredUDL: 2.0, serviceUDL: 1.3, unbracedLength: 8 });
    expect(st.error).toBeUndefined(); expect((st.display as { columns: string[] }).columns).toContain("φMn kip-ft");
    const bc = await runTool("bearing_capacity", { units: "US", cohesion: 0, frictionAngle: 30, unitWeight: 115, depth: 5, width: 6, shape: "square" });
    expect(bc.error).toBeUndefined(); expect(bc.summary).toMatch(/ksf/);
    const ep = await runTool("earth_pressure", { units: "US", frictionAngle: 30, height: 12, unitWeight: 120 });
    expect(ep.error).toBeUndefined(); expect(ep.summary).toMatch(/kip\/ft/);
  });
});
