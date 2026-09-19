/** DXF output for AutoCAD: valid R12 structure, pure ASCII (symbols as AutoCAD codes), design drawings attached to designs. */
import { describe, it, expect } from "vitest";
import { toDxf, dxfText } from "@/lib/drawing/dxf";
import { runTool } from "@/lib/tools";

describe("DXF", () => {
  it("writes symbols as AutoCAD codes, other characters as \\U+", () => {
    expect(dxfText("2-Ø22 BOTTOM")).toBe("2-%%c22 BOTTOM");
    expect(dxfText("45° ±5")).toBe("45%%d %%p5");
    expect(dxfText("3.85 × 5.19 m²")).toBe("3.85 \\U+00D7 5.19 m\\U+00B2");
    expect(dxfText("রান্নাঘর")).toMatch(/^(\\U\+[0-9A-F]{4})+$/);
  });
  it.each([
    ["design_rc_beam", { code: "BNBC2020", b: 250, D: 450, fck: 25, fy: 500, Mu: 120, Vu: 90, mainBarDia: 16 }],
    ["design_rc_column", { code: "ACI318", b: 406, D: 406, fck: 27.6, fy: 420, Pu: 1500, Mux: 80, Muy: 30, unsupportedLength: 3658 }],
    ["design_isolated_footing", { code: "BNBC2020", columnB: 300, columnD: 400, deadLoad: 600, liveLoad: 250, safeBearingCapacity: 150, fck: 25, fy: 500 }],
  ])("%s returns a drawing whose DXF is ASCII R12 with the designed bars", async (name, inp) => {
    const out = await runTool(name, inp);
    expect(out.error).toBeUndefined();
    const dxf = toDxf(out.drawing!.drawing);
    expect(/^[\x00-\x7F]*$/.test(dxf)).toBe(true);
    expect(dxf).toContain("AC1009");
    expect(dxf.trim().endsWith("EOF")).toBe(true);
    expect(dxf).toMatch(/%%c\d+/); // bar diameters in the labels
  });
});
