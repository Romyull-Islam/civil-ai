/** Plot shapes: exact areas (hand-computed), surveyor inputs, traverse closure, bearings, units and buildable area. */
import { describe, it, expect } from "vitest";
import { plotGeometry, buildableArea, parseBearing, polygonArea, type PlotInput } from "@/lib/eng/plot";

const area = (p: PlotInput) => plotGeometry(p).area;

describe("plot shapes", () => {
  it("areas of the standard shapes", () => {
    expect(area({ shape: "rectangular", width: 10, depth: 12 })).toBeCloseTo(120, 9);
    expect(area({ shape: "square", side: 15 })).toBeCloseTo(225, 9);
    expect(area({ shape: "trapezoid", frontWidth: 10, rearWidth: 8, depth: 20 })).toBeCloseTo(180, 9); // (10 + 8)/2 × 20
    expect(area({ shape: "triangle", front: 30, right: 40, left: 50 })).toBeCloseTo(600, 6); // 30-40-50 right triangle
    expect(area({ shape: "l_shape", width: 20, depth: 30, cutWidth: 8, cutDepth: 10 })).toBeCloseTo(520, 9);
    expect(area({ shape: "corner_cut", width: 20, depth: 25, chamfer: 3 })).toBeCloseTo(495.5, 9); // 500 − 3²/2
    expect(area({ shape: "flag", poleWidth: 4, poleLength: 15, flagWidth: 20, flagDepth: 18 })).toBeCloseTo(420, 9); // 60 + 360
  });
  it("four sides and a diagonal reproduce a known quadrilateral", () => {
    // A(0,0) B(10,0) C(11,15) D(−1,14): area 159.5 m² by the shoelace formula
    const A = [0, 0], B = [10, 0], C = [11, 15], D = [-1, 14];
    const d = (p: number[], q: number[]) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    const g = plotGeometry({ shape: "quadrilateral", front: d(A, B), right: d(B, C), rear: d(C, D), left: d(D, A), diagonal: d(A, C) });
    expect(g.area).toBeCloseTo(159.5, 6);
    expect(g.edges.map((e) => e.length)).toEqual([d(A, B), d(B, C), d(C, D), d(D, A)].map((x) => expect.closeTo(x, 6)));
    expect(() => plotGeometry({ shape: "quadrilateral", front: 10, right: 3, rear: 10, left: 3, diagonal: 20 })).toThrow(/do not close/);
  });
  it("bearings: quadrant and azimuth forms", () => {
    expect(parseBearing("N 45°30' E")).toBeCloseTo(45.5, 9);
    expect(parseBearing("S12W")).toBeCloseTo(192, 9);
    expect(parseBearing("N 30 W")).toBeCloseTo(330, 9);
    expect(parseBearing("S 45 E")).toBeCloseTo(135, 9);
    expect(parseBearing("123°30'")).toBeCloseTo(123.5, 9);
    expect(parseBearing(135.5)).toBe(135.5);
    expect(() => parseBearing("N 95 E")).toThrow();
  });
  it("traverse: closed square, and a misclosure corrected by the compass rule", () => {
    const sq = plotGeometry({ shape: "traverse", legs: [{ length: 20, bearing: "90" }, { length: 20, bearing: "0" }, { length: 20, bearing: "270" }, { length: 20, bearing: "180" }] });
    expect(sq.area).toBeCloseTo(400, 6);
    expect(sq.closure?.precision).toBe("exact");
    const off = plotGeometry({ shape: "traverse", legs: [{ length: 20, bearing: "N 90 E" }, { length: 20, bearing: "N 0 E" }, { length: 20, bearing: "N 90 W" }, { length: 20.02, bearing: "S 0 E" }] });
    expect(off.closure?.error).toBeCloseTo(0.02, 6);
    expect(off.closure?.precision).toBe("1 : 4001");
    expect(off.closure?.adjusted).toBe(true);
    expect(off.area).toBeCloseTo(400, 0);
  });
  it("feet are converted; clockwise input and any road edge end up with the road at the bottom", () => {
    expect(area({ shape: "rectangular", width: 40, depth: 60, units: "ft" })).toBeCloseTo(40 * 60 * 0.3048 ** 2, 6);
    const g = plotGeometry({ shape: "polygon", points: [[0, 0], [0, 10], [12, 10], [12, 0]], frontEdge: 3 }); // clockwise; edge 3 = (12,0)→(0,0)
    const road = g.edges.find((e) => e.role === "road")!;
    expect(road.length).toBeCloseTo(12, 9);
    expect([road.from[1], road.to[1]]).toEqual([0, 0]);
    expect(polygonArea(g.points)).toBeGreaterThan(0);
    expect(g.edges.filter((e) => e.role === "rear").map((e) => e.length)).toEqual([expect.closeTo(12, 9)]);
  });
  it("rejects boundaries that cross themselves", () => {
    expect(() => plotGeometry({ shape: "polygon", points: [[0, 0], [10, 10], [10, 0], [0, 10]] })).toThrow(/crosses itself/);
  });
  it("buildable area applies front, rear and side setbacks per edge", () => {
    const g = plotGeometry({ shape: "rectangular", width: 10, depth: 20 });
    const b = buildableArea(g, { front: 1.5, rear: 2, side: 1 });
    expect(b.rect!.width).toBeGreaterThan(7.85); expect(b.rect!.width).toBeLessThanOrEqual(8);
    expect(b.rect!.depth).toBeGreaterThan(16.35); expect(b.rect!.depth).toBeLessThanOrEqual(16.5);
    expect(b.rect!.x).toBeGreaterThanOrEqual(1); expect(b.rect!.y).toBeGreaterThanOrEqual(1.5);
    expect(b.area).toBeGreaterThan(128); expect(b.area).toBeLessThanOrEqual(132);
    // Trapezoid narrowing to the rear: the rectangle must stay inside the slanted sides.
    const t = plotGeometry({ shape: "trapezoid", frontWidth: 14, rearWidth: 8, depth: 20 });
    const bt = buildableArea(t, { front: 1.5, rear: 1.5, side: 1 });
    const r = bt.rect!;
    const halfWidthAt = (y: number) => (14 - ((14 - 8) * y) / 20) / 2; // centred trapezoid
    for (const y of [r.y, r.y + r.depth]) { expect(r.x).toBeGreaterThanOrEqual(7 - halfWidthAt(y) + 1 - 1e-9); expect(r.x + r.width).toBeLessThanOrEqual(7 + halfWidthAt(y) - 1 + 1e-9); }
  });
});

describe("US house planning (IRC)", () => {
  it("uses IRC room minimums, US room sizes and no Dhaka zoning defaults", async () => {
    const { planBuilding } = await import("@/lib/eng/layout");
    const r = planBuilding({ plot: { shape: "rectangular", width: 60, depth: 110, units: "ft" }, buildingType: "single_family", storeys: 1, bedrooms: 3, bathrooms: 2, garage: true, standard: "IRC2021" });
    expect((r.summary as { plotArea: number }).plotArea).toBeCloseTo(60 * 110 * 0.3048 ** 2, 3);
    expect(r.checks.find((c) => c.name === "Zoning setbacks")?.ok).toBe(false); // must come from the local ordinance
    expect(r.checks.some((c) => /Ground coverage/.test(c.name))).toBe(false);
    expect(r.floors[0].rooms.some((x) => x.name === "Garage (2 cars)")).toBe(true);
    const withZoning = planBuilding({ plot: { shape: "rectangular", width: 60, depth: 110, units: "ft" }, setback: { front: 7.62, rear: 6.1, side: 1.52 }, buildingType: "single_family", storeys: 1, bedrooms: 3, bathrooms: 2, standard: "IRC2021" });
    expect(withZoning.checks.find((c) => c.name === "Zoning setbacks")).toBeUndefined();
    const sizeChecks = withZoning.checks.filter((c) => /IRC R30[47]/.test(c.name));
    expect(sizeChecks.length).toBeGreaterThan(5);
    expect(sizeChecks.every((c) => c.ok)).toBe(true);
  });
});
