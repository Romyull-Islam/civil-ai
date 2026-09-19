/** Stormwater and Manning hydraulics: FHWA HEC-22 (3rd ed., SI) worked examples plus exact identities. */
import { describe, it, expect } from "vitest";
import { rationalMethod, kirpich, manningQ, normalDepth, sizePipe } from "@/lib/eng/drainage";

describe("rational method (HEC-22)", () => {
  it("Example 3-3: 17.55 ha, C 0.235 at 48 mm/h → 0.55 m³/s; C 0.315 at 58 mm/h → 0.89 m³/s", () => {
    expect(rationalMethod({ areas: [{ area: 17.55, C: 0.235 }], intensity: 48 }).Q).toBeCloseTo(0.55, 2);
    expect(rationalMethod({ areas: [{ area: 17.55, C: 0.315 }], intensity: 58 }).Q).toBeCloseTo(0.89, 2);
  });
  it("gutter example: (0.73)(180)(0.26)/360 = 0.095 m³/s", () => {
    expect(rationalMethod({ areas: [{ area: 0.26, C: 0.73 }], intensity: 180 }).Q).toBeCloseTo(0.095, 3);
  });
  it("composite C is area-weighted; frequency factor raises C for rare storms but never above 1", () => {
    const r = rationalMethod({ areas: [{ area: 1, C: 0.9 }, { area: 3, C: 0.3 }], intensity: 100 });
    expect(r.C).toBeCloseTo(0.45, 9);
    expect(rationalMethod({ areas: [{ area: 1, C: 0.9 }], intensity: 100, returnPeriod: 100 }).Ceff).toBe(1);
    expect(rationalMethod({ areas: [{ area: 1, C: 0.5 }], intensity: 100, returnPeriod: 25 }).Ceff).toBeCloseTo(0.55, 9);
    expect(rationalMethod({ units: "US", areas: [{ area: 2, C: 0.5 }], intensity: 4 }).Q).toBeCloseTo(4, 9); // Q = CiA in cfs
  });
  it("Kirpich gives the same tc in SI and US units", () => {
    expect(kirpich(3000 * 0.3048, 0.02, "SI").tc).toBeCloseTo(kirpich(3000, 0.02, "US").tc, 1);
  });
});

describe("Manning (HEC-22)", () => {
  it("Example 5-1: trapezoid B 0.8 m, z 3, d 0.5 m, S 0.01, n 0.030 → A 1.15, R 0.29, Q ≈ 1.67 m³/s, V ≈ 1.45 m/s", () => {
    const r = manningQ({ shape: "trapezoidal", bottomWidth: 0.8, sideSlope: 3 }, 0.5, 0.03, 0.01);
    expect(r.A).toBeCloseTo(1.15, 9);
    expect(r.P).toBeCloseTo(3.96, 2);
    expect(r.R).toBeCloseTo(0.29, 2);
    expect(Math.abs(r.Q - 1.67)).toBeLessThan(0.015); // HEC-22 rounds the exponent to 0.67; exact 2/3 gives 1.68
    expect(Math.abs(r.V - 1.45)).toBeLessThan(0.015);
  });
  it("part-full circular pipe: half full carries half the full flow; maximum at y/D ≈ 0.938 is ≈ 1.076 × full", () => {
    const sec = { shape: "circular" as const, diameter: 0.6 };
    const full = manningQ(sec, 0.6, 0.013, 0.005).Q;
    expect(manningQ(sec, 0.3, 0.013, 0.005).Q / full).toBeCloseTo(0.5, 9);
    expect(manningQ(sec, 0.938 * 0.6, 0.013, 0.005).Q / full).toBeCloseTo(1.076, 2);
    expect(normalDepth(sec, full / 2, 0.013, 0.005)!).toBeCloseTo(0.3, 4);
    expect(normalDepth(sec, full * 1.2, 0.013, 0.005)).toBeNull();
  });
  it("pipe sizing picks the smallest standard pipe that flows (full) at the design flow", () => {
    // Full-flow capacity at S = 0.5 %, n = 0.013: Ø450 ≈ 0.20 m³/s (too small), Ø525 ≈ 0.30 m³/s.
    const r = sizePipe({ Q: 0.25, slope: 0.005 });
    expect(r.diameter).toBe(525);
    expect(r.fullCapacity).toBeGreaterThan(0.25);
    expect(r.depthRatio).toBeLessThan(1);
    const us = sizePipe({ Q: 10, slope: 0.005, units: "US" }); // cfs
    expect(us.unit).toBe("in");
    expect(us.fullCapacity).toBeGreaterThanOrEqual(10);
  });
});
