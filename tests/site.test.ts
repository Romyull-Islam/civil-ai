/** Subdivision layout and landscape calculations. Expected values are hand-computed (shown in each test). */
import { describe, it, expect } from "vitest";
import { subdivide } from "@/lib/eng/subdivision";
import { plantsForArea, plantsForRow, bulkMaterial, waterBudget, sprinkler } from "@/lib/eng/landscape";
import { runTool } from "@/lib/tools";
import { checkTopic } from "@/lib/ai/topic";

describe("subdivision layout", () => {
  const base = { tract: { shape: "rectangular" as const, width: 200, depth: 110 }, lotWidth: 15, lotDepth: 30, streetWidth: 12 };
  it("rows: road | 30 | 30 | street 12 | 30 → 3 rows of 13 lots (200/15 = 13.3 → 13 lots of 15.38 m)", () => {
    const r = subdivide({ ...base, accessStreet: "none" });
    expect(r.rows).toBe(3);
    expect(r.lotCount).toBe(39);
    expect(r.lots[0].width).toBeCloseTo(200 / 13, 9);
    expect(r.streetArea).toBeCloseTo(12 * 200, 6);
    expect(r.shares.streets).toBeCloseTo((100 * 2400) / 22000, 6);
  });
  it("access street on the left (12 m wide, 72 m long) leaves 188 m per row → 12 lots per row", () => {
    const r = subdivide({ ...base, accessStreet: "left" });
    expect(r.lotCount).toBe(36);
    expect(r.streetArea).toBeCloseTo(12 * 72 + 12 * 188, 6);
    expect(r.lots.every((l) => l.x >= 12 - 1e-9)).toBe(true);
  });
  it("minimum lot area 500 m² widens lots to 16.67 m (12 per row); 10% open space takes 5 lots from the rear", () => {
    expect(subdivide({ ...base, accessStreet: "none", minLotArea: 500 }).lotCount).toBe(36);
    const os = subdivide({ ...base, accessStreet: "none", openSpacePercent: 10 });
    expect(os.lotCount).toBe(34); // 2,200 m² needed; each lot 461.5 m² → 5 lots
    expect(os.openSpaceArea).toBeCloseTo(5 * (200 / 13) * 30, 6);
    expect(os.lots.filter((l) => l.openSpace).every((l) => l.row === 3)).toBe(true);
  });
  it("irregular tract: every lot lies inside the boundary", () => {
    const r = subdivide({ tract: { shape: "trapezoid", frontWidth: 150, rearWidth: 90, depth: 120 }, lotWidth: 12, lotDepth: 25, streetWidth: 9, accessStreet: "left" });
    const poly = r.tract.points;
    const inside = ([x, y]: number[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    expect(r.lotCount).toBeGreaterThan(20);
    for (const l of r.lots) for (const c of [[l.x + 1e-6, l.y + 1e-6], [l.x + l.width - 1e-6, l.y + 1e-6], [l.x + l.width - 1e-6, l.y + l.depth - 1e-6], [l.x + 1e-6, l.y + l.depth - 1e-6]]) expect(inside(c), `lot ${l.no}`).toBe(true);
  });
  it("USA (feet): 660 × 660 ft, 60 × 110 ft lots, 50 ft streets → 5 rows × 10 lots; dead-end streets over 150 ft are flagged", () => {
    const r = subdivide({ tract: { shape: "rectangular", width: 660, depth: 660, units: "ft" }, units: "ft", lotWidth: 60, lotDepth: 110, streetWidth: 50, pavementWidth: 28, accessStreet: "left", country: "US" });
    expect(r.rows).toBe(5);
    expect(r.lotCount).toBe(50); // (660 − 50)/60 = 10.2 → 10 per row
    expect(r.density.perAcre).toBeCloseTo(50 / 10, 6); // 660² ft² = 10 acres
    expect(r.checks.find((c) => /IFC 503.2.1/.test(c.name))?.ok).toBe(true);
    expect(r.checks.find((c) => /IFC 503.2.5/.test(c.name))?.ok).toBe(false);
  });
  it("tool: DXF site plan and an Excel lot schedule", async () => {
    const out = await runTool("subdivision_layout", { tract: { shape: "rectangular", width: 200, depth: 110 }, lotWidth: 10, lotDepth: 20, streetWidth: 7.5, country: "BD" });
    expect(out.error).toBeUndefined();
    expect(out.display?.kind).toBe("drawing");
    expect(out.workbook?.sheets[0].name).toBe("Lots");
    expect(out.summary).toMatch(/katha/);
  });
});

describe("landscape", () => {
  it("plants: 100 m² at 0.5 m → 400 square, 462 triangular (100/(0.866×0.25)); a 30 m row at 3 m → 11", () => {
    expect(plantsForArea(100, 0.5, "square").plants).toBe(400);
    expect(plantsForArea(100, 0.5, "triangular").plants).toBe(462);
    expect(plantsForRow(30, 3)).toBe(11);
  });
  it("materials: 50 m² × 75 mm = 3.75 m³; 1,000 sq ft × 3 in = 250 cu ft = 9.26 yd³ = 125 bags of 2 cu ft", () => {
    expect(bulkMaterial(50, 75, "SI", undefined, 0).volume).toBeCloseTo(3.75, 9);
    const us = bulkMaterial(1000, 3, "US", 2, 0);
    expect(us.volume).toBeCloseTo(250 / 27, 9);
    expect(us.bags).toBe(125);
  });
  it("water budget (MWELO): ETo 50 in, 10,000 sq ft residential → MAWA 170,500 gal; hydrozones use 168,089 gal", () => {
    // MAWA = 50 × 0.62 × 0.55 × 10,000; ETWU = 50 × 0.62 × (0.3/0.81 × 6,000 + 0.6/0.75 × 4,000)
    const r = waterBudget({ eto: 50, zones: [{ area: 6000, plantFactor: 0.3, irrigation: "drip" }, { area: 4000, plantFactor: 0.6, irrigation: "overhead" }] });
    expect(r.mawa).toBeCloseTo(170500, 6);
    expect(r.etwu).toBeCloseTo(50 * 0.62 * ((0.3 / 0.81) * 6000 + 0.8 * 4000), 6);
    expect(r.ok).toBe(true);
    const si = waterBudget({ units: "SI", eto: 1500, zones: [{ area: 300, plantFactor: 0.7 }] });
    expect(si.etwu).toBeCloseTo(420000, 6); // 0.7/0.75 × 300 × 1500 litres
    expect(si.mawa).toBeCloseTo(247500, 6);
    expect(si.ok).toBe(false);
  });
  it("sprinkler: 4 gpm on 30 × 30 ft → 0.428 in/h, 187 min/week for 1 in at DU 0.75; 15 L/min on 100 m² → 9 mm/h", () => {
    const us = sprinkler({ flow: 4, spacing: 30, depthPerWeek: 1 });
    expect(us.precipitationRate).toBeCloseTo((96.3 * 4) / 900, 9);
    expect(us.minutesPerWeek).toBeCloseTo((1 / (((96.3 * 4) / 900) * 0.75)) * 60, 6);
    expect(sprinkler({ units: "SI", flow: 15, area: 100, depthPerWeek: 25 }).precipitationRate).toBeCloseTo(9, 9);
  });
  it("landscape questions pass the civil-only filter", () => {
    for (const q of ["how many shrubs for a 100 m2 bed?", "subdivide my 5 bigha land into plots with a 6 m road", "landscaping plan for a housing project", "mulch needed for 500 sq ft at 3 inches", "best trees for my garden"]) expect(checkTopic([{ role: "user", parts: [{ type: "text", text: q }] }], true).action, q).toBe("allow");
  });
});
