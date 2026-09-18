import { describe, it, expect } from "vitest";
import { ungroundedNumbers } from "@/lib/ai/grounding";
import { runTool } from "@/lib/tools";

const question = "How many bags of cement, cft of sand and cft of stone chips for 100 cft of 1:2:4 (M20) concrete?";
async function toolContent(name: string, args: Record<string, unknown>) {
  const o = await runTool(name, args);
  return JSON.stringify({ summary: o.summary, result: o.result }, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v));
}

describe("numeric grounding", () => {
  it("passes a correct answer that quotes the tool (real Gemini reply)", async () => {
    const tool = await toolContent("concrete_materials", { volume: 100, volumeUnit: "cft", ratio: "1:2:4", grade: "M20" });
    const answer = `For 100 cft of wet concrete using a 1:2:4 mix (dry volume factor 1.54, 3% wastage):
Cement: 19 bags (924 kg / 22.66 cft)
Sand: 45.32 cft (1.28 m³)
Stone Chips (Coarse Aggregate): 90.64 cft (2.57 m³)
Water: Approx. 462 liters (at a 0.5 water-cement ratio)
Dry Volume = 100 × 1.54 × 1.03 = 158.62 cft. Cement: 158.62 × 1/7 = 22.66 cft, 924 kg, 18.5 bags, rounded up to 19 bags.
Note: per IS 456 and BNBC 2020, verify with a licensed engineer.`;
    expect(ungroundedNumbers(answer, [question, tool])).toEqual([]);
  });

  it("flags invented figures (real gpt-oss-20b reply)", async () => {
    const tool = await toolContent("concrete_materials", { volume: 2.83168, grade: "M20" });
    const answer = `Cement 24 bags (15.5 kg each, 24 × 15.5 = 372 kg). Sand 43 cft (≈ 1.22 m³). Stone chips 86 cft (≈ 2.45 m³).
Dry mix volume 100 cft × 1.54 = 154 cft. Cement volume 154 cft × (1 / 6) = 25.67 cft ≈ 0.817 m³ → 0.817 m³ / 0.006 m³ per 15.5 kg bag = 24 bags.
Sand volume 154 cft × (2 / 6) = 51.33 cft. Aggregate volume 154 cft × (3 / 6) = 77.00 cft.`;
    const bad = ungroundedNumbers(answer, [question, tool]);
    for (const x of ["15.5", "372", "25.67", "0.006", "51.33", "77.00", "154"]) expect(bad).toContain(x);
  });

  it("ignores code names, grades, years and list numbers", () => {
    const answer = "1. Per IS 456:2000 clause 26.5.1.1 and BNBC 2020, use M20 concrete, Fe500 steel, Grade 60 bars, 4 Ø16.";
    expect(ungroundedNumbers(answer, [])).toEqual([]);
  });

  it("accepts rounding to the precision written", () => {
    expect(ungroundedNumbers("Moment 112.5 kN·m, about 113 kN·m, shear 75.0 kN", ["{\"M\":112.5,\"V\":75.0001}"])).toEqual([]);
    expect(ungroundedNumbers("Moment 120 kN·m", ["{\"M\":112.5}"])).toEqual(["120"]);
  });
});
