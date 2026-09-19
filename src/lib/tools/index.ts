/**
 * Tool registry: every calculator/drawing the AI agent (and the Calculators UI) can call.
 * Each tool has a zod schema (→ JSON schema for the LLM), a deterministic run(), and an optional
 * rich display payload the chat UI knows how to render (charts, drawings, tables).
 */
import { z } from "zod";
import { analyzeBeam, rectI, type BeamResult } from "@/lib/eng/beam";
import { convert, UNIT_CATALOG } from "@/lib/eng/units";
import { designRcBeam, designOneWaySlab, designIsolatedFooting } from "@/lib/eng/rc";
import { designColumn } from "@/lib/eng/column";
import { bearingCapacity, earthPressure, consolidationSettlement, sptAllowablePressure, stress21 } from "@/lib/eng/soil";
import { concreteMaterials, rebarSchedule, brickMasonry, plasterQuantity, paintQuantity, tileQuantity, excavation, NOMINAL_MIXES, CFT_PER_M3 } from "@/lib/eng/quantity";
import { averageEndArea, prismoidal, gridCutFill, trapezoidalSection } from "@/lib/eng/earthwork";
import { designSteelBeam, findSection, SECTIONS } from "@/lib/eng/steel";
import { searchCodes } from "@/lib/eng/codes";
import { evaluate } from "@/lib/eng/calc";
import { planLayout, plotStats, planBuilding } from "@/lib/eng/layout";
import type { Drawing as DrawingModel, Entity as DrawingEntity } from "@/lib/drawing/types";
import { beamSection, columnSection, footingDrawing, floorPlan, beamElevation } from "@/lib/drawing/templates";
import { toSvg } from "@/lib/drawing/svg";
import { type Drawing, DEFAULT_LAYERS } from "@/lib/drawing/types";

export type Display =
  | { kind: "beam"; result: BeamResult }
  | { kind: "drawing"; drawing: Drawing; svg: string }
  | { kind: "table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | { kind: "steps"; title?: string; steps: string[]; checks?: { name: string; ok: boolean; detail: string }[] };

export interface ToolOutput { result: unknown; display?: Display; summary?: string }

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  category: "analysis" | "design" | "geotech" | "quantities" | "drawing" | "reference" | "utility";
  description: string;
  schema: S;
  run: (input: z.infer<S>) => ToolOutput | Promise<ToolOutput>;
}

const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t as unknown as ToolDef;

const loadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("point"), magnitude: z.number().describe("kN, positive downward"), position: z.number().describe("m from left support") }),
  z.object({ type: z.literal("udl"), magnitude: z.number().describe("kN/m, positive downward"), start: z.number().optional().describe("m from left (default 0)"), end: z.number().optional().describe("m from left (default span)") }),
  z.object({ type: z.literal("moment"), magnitude: z.number().describe("kN·m, clockwise positive"), position: z.number() }),
]);

const drawingOut = (drawing: Drawing, summary: string): ToolOutput => ({ result: { title: drawing.title, entities: drawing.entities.length, notes: drawing.notes }, display: { kind: "drawing", drawing, svg: toSvg(drawing) }, summary });

export const TOOLS: ToolDef[] = [
  def({
    name: "analyze_beam",
    category: "analysis",
    description: "Analyze a single-span beam (simply supported, cantilever fixed at left, fixed-fixed, propped cantilever) under point loads, UDLs and moments. Returns reactions, max shear, max moments, deflection (if E and I given) and SFD/BMD data. Units: m, kN, kN/m, kN·m, E in MPa, I in mm⁴.",
    schema: z.object({
      span: z.number().positive().describe("m"),
      support: z.enum(["simply_supported", "cantilever", "fixed_fixed", "propped_cantilever"]),
      loads: z.array(loadSchema).min(1),
      E: z.number().optional().describe("Young's modulus MPa (steel 200000, concrete ≈ 5000√fck)"),
      I: z.number().optional().describe("second moment of area mm⁴"),
      section: z.object({ b: z.number(), h: z.number() }).optional().describe("rectangular concrete section mm to compute I automatically (use with E)"),
      steelSection: z.string().optional().describe("rolled steel section name e.g. 'ISMB 300' or 'W12x26' → sets E = 200000 MPa and I from the section table"),
    }),
    run: (inp) => {
      const steel = inp.steelSection ? findSection(inp.steelSection) : undefined;
      if (inp.steelSection && !steel) throw new Error(`Unknown steel section "${inp.steelSection}". Known: ${SECTIONS.map((s) => s.name).join(", ")}`);
      const I = inp.I ?? (steel ? steel.Ix * 1e4 : inp.section ? rectI(inp.section.b, inp.section.h) : undefined);
      const E = inp.E ?? (steel ? 200000 : inp.section ? 25000 : undefined);
      const r = analyzeBeam({ span: inp.span, support: inp.support, loads: inp.loads, E, I });
      const result = { reactions: r.reactions, maxShear: r.maxShear, maxMomentPositive: r.maxMomentPositive, maxMomentNegative: r.maxMomentNegative, maxDeflection_mm: r.maxDeflection, notes: r.notes };
      return { result, display: { kind: "beam", result: r }, summary: `Mmax = ${r.maxMomentPositive.value.toFixed(2)} kN·m at x = ${r.maxMomentPositive.x.toFixed(2)} m; Vmax = ${r.maxShear.value.toFixed(2)} kN` };
    },
  }),
  def({
    name: "design_rc_beam",
    category: "design",
    description: "Design a rectangular reinforced-concrete beam for flexure (singly or doubly reinforced) and shear. Codes: BNBC2020 (Bangladesh, default), ACI318 (ACI 318-19) or IS456 (IS 456:2000). Inputs mm, MPa, kN·m, kN. Give span and support to also check depth for deflection.",
    schema: z.object({
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      b: z.number().positive().describe("width mm"), D: z.number().positive().describe("overall depth mm"),
      cover: z.number().optional().describe("clear cover to stirrups mm (default 40 BNBC/ACI, 25 IS)"),
      fck: z.number().positive().describe("concrete strength MPa: f'c for BNBC/ACI, fck for IS"), fy: z.number().positive().describe("main steel yield MPa"),
      fyStirrup: z.number().optional().describe("stirrup yield MPa (default = fy; capped at 420 BNBC/ACI, 415 IS)"),
      Mu: z.number().positive().describe("factored moment kN·m"), Vu: z.number().optional().describe("factored shear kN"),
      stirrupDia: z.number().optional(), mainBarDia: z.number().default(16),
      span: z.number().optional().describe("m, for the depth/deflection check"), support: z.enum(["simply_supported", "one_end_continuous", "both_ends_continuous", "cantilever"]).optional(),
    }),
    run: (inp) => {
      const r = designRcBeam(inp);
      const summary = `${r.code}: As = ${r.AstRequired.toFixed(0)} mm² → ${r.tensionBars[0]?.label ?? "increase section"}${r.AscRequired > 0 ? `; compression steel ${r.AscRequired.toFixed(0)} mm² → ${r.compressionBars?.[0]?.label ?? ""}` : ""}${r.shear ? `; ${r.shear.stirrupLabel}` : ""}`;
      return { result: r, display: { kind: "steps", title: `RC beam ${inp.b}×${inp.D} (${r.code})`, steps: r.steps, checks: r.checks }, summary };
    },
  }),
  def({
    name: "design_rc_column",
    category: "design",
    description: "Design or check a rectangular tied RC column for axial load with uniaxial or biaxial moments, by strain compatibility (interaction diagram), including slenderness (moment magnification for braced frames) and minimum eccentricity. Codes: BNBC2020 (default), ACI318, IS456. Finds the lightest bar arrangement if bars are not given. Inputs mm, MPa, kN, kN·m.",
    schema: z.object({
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      b: z.number().positive().describe("column width mm (x direction)"), D: z.number().positive().describe("column depth mm (y direction)"),
      fck: z.number().positive().describe("f'c (BNBC/ACI) or fck (IS), MPa"), fy: z.number().positive(),
      Pu: z.number().nonnegative().describe("factored axial load kN"),
      Mux: z.number().optional().describe("factored moment about x (bending over depth D), kN·m, larger end moment"),
      Muy: z.number().optional().describe("factored moment about y (bending over width b), kN·m"),
      unsupportedLength: z.number().optional().describe("clear height between floors, mm (default 3000)"),
      k: z.number().optional().describe("effective length factor (default 1.0 braced)"),
      braced: z.boolean().optional().describe("non-sway (braced) frame, default true"),
      endMomentRatio: z.number().optional().describe("|M1/M2| smaller/larger end moment, 0–1 (default 1)"),
      curvature: z.enum(["single", "double"]).optional().describe("single (default, conservative) or double curvature"),
      bars: z.object({ count: z.number().int().min(4), dia: z.number().positive() }).optional().describe("check this arrangement instead of designing"),
      clearCover: z.number().optional().describe("mm, default 40"),
    }),
    run: (inp) => {
      const r = designColumn({ code: inp.code, b: inp.b, h: inp.D, fc: inp.fck, fy: inp.fy, Pu: inp.Pu, Mux: inp.Mux, Muy: inp.Muy, lu: inp.unsupportedLength, k: inp.k, braced: inp.braced, endMomentRatio: inp.endMomentRatio, curvature: inp.curvature, bars: inp.bars, clearCover: inp.clearCover });
      const { curve: _c, ...rest } = r; void _c;
      return { result: { ...rest, AscRequired: r.bars.area, steelPercent: r.bars.percent }, display: { kind: "steps", title: `RC column ${inp.b}×${inp.D} (${r.code})`, steps: r.steps, checks: r.checks }, summary: `${r.code}: ${r.bars.label} (${r.bars.area.toFixed(0)} mm², ${r.bars.percent.toFixed(2)}%), ${r.ties}; ${r.ok ? "all checks pass" : "CHECKS FAIL: " + r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}` };
    },
  }),
  def({
    name: "design_one_way_slab",
    category: "design",
    description: "Design a one-way RC slab: thickness (deflection), bottom and top bars, distribution bars, shear check. Codes: BNBC2020 (default), ACI318, IS456. Supports: simply supported, end span (one end continuous), interior span (both ends continuous), cantilever. Units m, kN/m², MPa.",
    schema: z.object({
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      span: z.number().positive().describe("effective span m"), liveLoad: z.number().nonnegative().describe("kN/m²"),
      floorFinish: z.number().default(1).describe("kN/m²"), partitionLoad: z.number().optional().describe("extra dead load kN/m²"),
      fck: z.number().positive(), fy: z.number().positive(), cover: z.number().default(20),
      support: z.enum(["simply_supported", "one_end_continuous", "both_ends_continuous", "cantilever"]).default("simply_supported"),
      thickness: z.number().optional().describe("mm override"), barDia: z.number().optional().describe("main bar mm, default 10"),
      brickAggregate: z.boolean().optional().describe("brick-chip (khoa) aggregate concrete: 1.5× minimum steel under BNBC"),
    }),
    run: (inp) => { const r = designOneWaySlab(inp); return { result: r, display: { kind: "steps", title: `One-way slab, span ${inp.span} m (${r.code})`, steps: r.steps, checks: r.checks }, summary: `${r.code}: h = ${r.thickness} mm; ${r.mainBars}${r.topBars ? `; ${r.topBars}` : ""}; distribution ${r.distributionBars}` }; },
  }),
  def({
    name: "design_isolated_footing",
    category: "design",
    description: "Size and design a square isolated RC footing: plan size from allowable bearing, depth from one-way and punching shear, bottom bars, development length and column bearing. Codes: BNBC2020 (default), ACI318, IS456. Give dead and live loads separately when known. Units mm, kN, kN/m², MPa.",
    schema: z.object({
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      columnB: z.number().positive().describe("mm"), columnD: z.number().positive().describe("mm"),
      serviceLoad: z.number().positive().optional().describe("total unfactored column load kN (if dead/live not given)"),
      deadLoad: z.number().nonnegative().optional().describe("unfactored dead load kN"), liveLoad: z.number().nonnegative().optional().describe("unfactored live load kN"),
      safeBearingCapacity: z.number().positive().describe("allowable net bearing pressure kN/m²"),
      fck: z.number().positive(), fy: z.number().positive(),
      cover: z.number().optional().describe("mm, default 75 BNBC/ACI, 50 IS"), barDia: z.number().optional().describe("mm, default 16"),
      brickAggregate: z.boolean().optional(),
    }),
    run: (inp) => { const r = designIsolatedFooting(inp); return { result: r, display: { kind: "steps", title: `Isolated footing ${r.side}×${r.side} m (${r.code})`, steps: r.steps, checks: r.checks }, summary: `${r.code}: ${r.side} × ${r.side} m × ${r.depth} mm; ${r.bars}` }; },
  }),
  def({
    name: "design_steel_beam",
    category: "design",
    description: "Select or check a rolled steel I-section (ISMB per IS 808:2021, or AISC W-shape) for a simply supported beam or cantilever per IS 800:2007 or AISC 360-16 (LRFD): bending with lateral-torsional buckling when the compression flange is unbraced (give unbracedLength), section class, web shear with high-shear reduction, and deflection. Units m, kN, kN/m, kN·m, MPa.",
    schema: z.object({ code: z.enum(["IS800", "AISC"]).default("IS800"), span: z.number().positive(), support: z.enum(["simply_supported", "cantilever"]).default("simply_supported"), factoredUDL: z.number().optional().describe("kN/m"), factoredPointLoad: z.number().optional().describe("kN at midspan (SS) or at the tip (cantilever)"), serviceUDL: z.number().optional().describe("kN/m unfactored, for deflection"), servicePointLoad: z.number().optional().describe("kN unfactored, for deflection"), factoredMoment: z.number().optional().describe("kN·m, overrides loads"), fy: z.number().optional(), section: z.string().optional().describe(`check a specific section, e.g. ${SECTIONS.slice(0, 3).map((s) => s.name).join(", ")}`), deflectionLimit: z.number().optional().describe("span/N, default 300 SS or 150 cantilever") , unbracedLength: z.number().positive().optional().describe("m, laterally unbraced length of the compression flange; omit if continuously restrained"), momentFactor: z.number().positive().optional().describe("c1 (IS 800 Annex E) or Cb (AISC) for the moment diagram, default 1.0")}),
    run: (inp) => { const r = designSteelBeam(inp); return { result: r, display: { kind: "table", title: `Steel beam candidates (${r.support}, Mu = ${r.Mu.toFixed(1)} kN·m, Vu = ${r.Vu.toFixed(1)} kN)`, columns: ["Section", "Class", "Mass kg/m", "Md kN·m", "Bending util.", "Vd kN", "Shear util.", "Deflection mm", "Limit mm", "OK"], rows: r.candidates.map((c) => [c.section, c.sectionClass, c.mass.toFixed(1), c.momentCapacity.toFixed(1), c.utilization.toFixed(2), c.shearCapacity.toFixed(0), c.shearUtilization.toFixed(2), c.deflection?.toFixed(1) ?? "-", c.deflectionLimit.toFixed(1), c.ok ? "✓" : "✗"]) }, summary: r.recommended ? `Use ${r.recommended.section} (bending ${(r.recommended.utilization * 100).toFixed(0)}%, shear ${(r.recommended.shearUtilization * 100).toFixed(0)}%${r.recommended.deflection !== undefined ? `, deflection ${r.recommended.deflection.toFixed(1)} mm ≤ ${r.recommended.deflectionLimit.toFixed(1)} mm` : ""})` : inp.section ? `${r.candidates[0]?.section}: ${r.candidates[0]?.ok ? "OK" : `FAILS: bending util ${(r.candidates[0]!.utilization * 100).toFixed(0)}%, shear util ${(r.candidates[0]!.shearUtilization * 100).toFixed(0)}%${r.candidates[0]?.deflection !== undefined ? `, deflection ${r.candidates[0]!.deflection!.toFixed(1)} mm vs limit ${r.candidates[0]!.deflectionLimit.toFixed(1)} mm` : ""}`}` : "No section in the table works. Increase depth or use a built-up section." }; },
  }),
  def({
    name: "bearing_capacity",
    category: "geotech",
    description: "Ultimate and safe bearing capacity of a shallow footing (strip/square/circular/rectangular), Terzaghi (default) or IS 6403 method, general or local shear, with water table and (IS 6403) load inclination. FS default 3 (BNBC 2020 allows 2–3). Units kPa, degrees, kN/m³, m. Bearing capacity alone does not limit settlement: also run the settlement tool.",
    schema: z.object({
      cohesion: z.number().nonnegative().describe("kPa"), frictionAngle: z.number().min(0).max(50).describe("degrees"),
      unitWeight: z.number().positive().describe("kN/m³ above the water table"), saturatedUnitWeight: z.number().positive().optional().describe("kN/m³ below the water table"),
      depth: z.number().nonnegative().describe("founding depth m"), width: z.number().positive().describe("m"), length: z.number().optional(),
      shape: z.enum(["strip", "square", "circular", "rectangular"]).optional(), waterTableDepth: z.number().optional().describe("m below ground"),
      factorOfSafety: z.number().optional(), method: z.enum(["terzaghi", "is6403"]).optional(), shearMode: z.enum(["general", "local"]).optional().describe("local for loose sand / soft clay"),
      loadInclination: z.number().optional().describe("degrees from vertical (IS 6403)"),
    }),
    run: (inp) => { const r = bearingCapacity(inp); return { result: r, display: { kind: "steps", title: `${r.method} bearing capacity`, steps: [...r.steps, ...r.notes] }, summary: `${r.method}: net ultimate ${r.netUltimate.toFixed(0)} kPa; net safe ${r.netSafe.toFixed(0)} kPa, gross safe ${r.safe.toFixed(0)} kPa (FS ${r.factorOfSafety})` }; },
  }),
  def({
    name: "settlement",
    category: "geotech",
    description: "Foundation settlement. mode 'clay': primary consolidation of one or more clay layers (normally or over-consolidated); stress increase by the 2:1 method from footing size and net pressure if not given. mode 'sand_spt': net allowable pressure for a target settlement from SPT N60 (Meyerhof/Bowles), and the settlement under a given pressure. BNBC 2020 limits for isolated footings: 25 mm on sand, 40 mm on clay. Units m, kPa, mm.",
    schema: z.object({
      mode: z.enum(["clay", "sand_spt"]),
      footingWidth: z.number().positive().describe("B, m"), footingLength: z.number().positive().optional().describe("L, m (default = B)"),
      netPressure: z.number().nonnegative().optional().describe("net footing pressure kPa"), foundingDepth: z.number().nonnegative().optional().describe("Df, m"),
      layers: z.array(z.object({ thickness: z.number().positive(), e0: z.number().positive(), Cc: z.number().positive(), Cr: z.number().positive().optional(), sigma0: z.number().positive().describe("effective overburden at mid-layer kPa"), deltaSigma: z.number().nonnegative().optional().describe("kPa; default by 2:1 from the footing"), midDepthBelowBase: z.number().nonnegative().optional().describe("m, for the 2:1 stress"), sigmaP: z.number().positive().optional().describe("preconsolidation pressure kPa") })).optional(),
      N60: z.number().positive().optional().describe("corrected SPT N60 (sand)"), allowableSettlement: z.number().positive().optional().describe("mm (default 25 sand, 40 clay per BNBC)"),
    }),
    run: (inp) => {
      const B = inp.footingWidth, L = inp.footingLength ?? inp.footingWidth;
      if (inp.mode === "sand_spt") {
        if (!inp.N60) throw new Error("Give N60 for sand");
        const S = inp.allowableSettlement ?? 25;
        const qa = sptAllowablePressure(inp.N60, B, inp.foundingDepth ?? 0, S);
        const q25 = sptAllowablePressure(inp.N60, B, inp.foundingDepth ?? 0, 25);
        const est = inp.netPressure !== undefined ? (25 * inp.netPressure) / q25 : undefined;
        return { result: { allowableNetPressure: qa, settlementLimit: S, estimatedSettlement: est }, summary: `Net allowable pressure for ${S} mm settlement: ${qa.toFixed(0)} kPa${est !== undefined ? `; under ${inp.netPressure} kPa the settlement is about ${est.toFixed(1)} mm` : ""} (Meyerhof/Bowles, N60 = ${inp.N60})` };
      }
      if (!inp.layers?.length) throw new Error("Give at least one clay layer");
      const rows = inp.layers.map((l, i) => {
        const dS = l.deltaSigma ?? (inp.netPressure !== undefined && l.midDepthBelowBase !== undefined ? stress21(inp.netPressure, B, L, l.midDepthBelowBase) : undefined);
        if (dS === undefined) throw new Error(`Layer ${i + 1}: give deltaSigma, or netPressure and midDepthBelowBase`);
        const r = consolidationSettlement({ ...l, deltaSigma: dS });
        return { layer: i + 1, deltaSigma: dS, ...r };
      });
      const total = rows.reduce((a, r) => a + r.settlement, 0);
      const lim = inp.allowableSettlement ?? 40;
      return { result: { layers: rows, total, limit: lim, ok: total <= lim }, display: { kind: "table", title: "Consolidation settlement", columns: ["Layer", "Δσ kPa", "Case", "Settlement mm"], rows: [...rows.map((r) => [r.layer, r.deltaSigma.toFixed(1), r.case, r.settlement.toFixed(1)]), ["Total", "", "", total.toFixed(1)]] }, summary: `Primary consolidation settlement ${total.toFixed(1)} mm (${total <= lim ? "within" : "EXCEEDS"} ${lim} mm)` };
    },
  }),
  def({
    name: "earth_pressure",
    category: "geotech",
    description: "Rankine active and passive earth pressure on a vertical wall: coefficients, resultant force and its height above the base, with surcharge, cohesion (tension crack) and a water table. Units kPa, kN/m³, m, degrees.",
    schema: z.object({ frictionAngle: z.number(), height: z.number().positive().describe("m"), unitWeight: z.number().positive().describe("kN/m³ above the water table"), saturatedUnitWeight: z.number().positive().optional(), surcharge: z.number().default(0).describe("kPa"), cohesion: z.number().default(0).describe("kPa"), waterTableDepth: z.number().optional().describe("m below the top of the wall") }),
    run: (inp) => { const r = earthPressure(inp.frictionAngle, inp.height, inp.unitWeight, inp.surcharge, inp.cohesion, { saturatedUnitWeight: inp.saturatedUnitWeight, waterTableDepth: inp.waterTableDepth }); return { result: r, summary: `Ka = ${r.Ka.toFixed(3)}; active thrust Pa = ${r.activeForce.toFixed(1)} kN/m acting ${r.activeArm.toFixed(2)} m above the base${r.tensionCrackDepth ? `; tension crack ${r.tensionCrackDepth.toFixed(2)} m` : ""}` }; },
  }),

  def({
    name: "concrete_materials",
    category: "quantities",
    description: `Cement (50 kg bags), sand and coarse aggregate (stone chips) for nominal/volume-mix concrete. Pass the mix ratio exactly as the user wrote it (e.g. "1:2:4"), or a grade (${Object.keys(NOMINAL_MIXES).join(", ")}) when no ratio is given. Takes the volume in m³ or cft; no unit conversion needed. Returns worked steps.`,
    schema: z.object({
      volume: z.number().positive().describe("wet concrete volume, in volumeUnit"),
      volumeUnit: z.enum(["m3", "cft"]).default("m3"),
      ratio: z.string().optional().describe('cement:sand:aggregate by volume, e.g. "1:2:4". Takes priority over grade.'),
      grade: z.string().optional().describe("e.g. M20; used when no ratio is given"),
      wastagePercent: z.number().default(3),
    }),
    run: (inp) => {
      const mix = inp.ratio ?? inp.grade;
      if (!mix) throw new Error("Give a ratio (e.g. 1:2:4) or a grade (e.g. M20).");
      const r = concreteMaterials(inp.volume, mix, inp.wastagePercent, { unit: inp.volumeUnit, grade: inp.ratio ? inp.grade : undefined });
      const cft = r.unit === "cft";
      const q = (x: { m3: number; cft: number }) => (cft ? `${x.cft.toFixed(1)} cft (${x.m3.toFixed(2)} m³)` : `${x.m3.toFixed(2)} m³ (${x.cft.toFixed(1)} cft)`);
      const u = cft ? "cft" : "m³";
      return {
        result: r,
        display: { kind: "table", title: `${r.ratio}${r.grade ? ` (${r.grade})` : ""} concrete, ${inp.volume} ${u}, wastage ${inp.wastagePercent}%`, columns: ["Material", "Quantity"], rows: [["Cement", `${r.cement.bags} bags of 50 kg (${r.cement.bagsExact.toFixed(1)} exact, ${r.cement.kg.toFixed(0)} kg)`], ["Sand", q(r.sand)], ["Stone chips / aggregate", q(r.aggregate)], ["Water", `${r.water.liters.toFixed(0)} L`]] },
        summary: `${r.ratio}: ${r.cement.bags} bags cement, sand ${q(r.sand)}, stone chips ${q(r.aggregate)}${inp.ratio && inp.grade && r.notes.length > 2 ? `. Note: ${r.notes[0]}` : ""}`,
      };
    },
  }),
  def({
    name: "rebar_schedule",
    category: "quantities",
    description: "Bar bending schedule weights: total length and kg per bar diameter (d²/162 kg/m).",
    schema: z.object({ items: z.array(z.object({ label: z.string().optional(), diameter: z.number().positive().describe("mm"), length: z.number().positive().describe("m per bar"), count: z.number().int().positive() })).min(1), wastagePercent: z.number().default(3) }),
    run: (inp) => { const r = rebarSchedule(inp.items, inp.wastagePercent); return { result: r, display: { kind: "table", title: "Bar bending schedule", columns: ["Label", "Ø mm", "Length m", "No.", "Total m", "kg"], rows: [...r.rows.map((x) => [x.label ?? "-", x.diameter, x.length, x.count, x.totalLength.toFixed(2), x.weightKg.toFixed(1)]), ["TOTAL", "", "", "", "", r.totalKg.toFixed(1)], ["+ wastage", "", "", "", "", r.totalWithWastageKg.toFixed(1)]] }, summary: `Total steel ${r.totalKg.toFixed(1)} kg (${r.totalWithWastageKg.toFixed(1)} kg with wastage)` }; },
  }),
  def({
    name: "masonry_and_finishes",
    category: "quantities",
    description: "Quantities for brick masonry (m³), plaster (m²), paint (m²), tiles (m²) and excavation. Provide any subset of inputs.",
    schema: z.object({
      brickworkVolume: z.number().optional().describe("brickwork volume in volumeUnit"), volumeUnit: z.enum(["m3", "cft"]).default("m3").describe("unit of brickworkVolume"),
      brickType: z.enum(["bd_standard", "india_modular"]).default("bd_standard").describe("bd_standard = Bangladesh 9.5×4.5×2.75 in; india_modular = 190×90×90 mm"),
      mortarRatio: z.number().default(4).describe("cement:sand 1:N"),
      plasterArea: z.number().optional().describe("m²"), plasterThickness: z.number().default(12).describe("mm"),
      paintArea: z.number().optional().describe("m²"), coats: z.number().default(2),
      tileArea: z.number().optional().describe("m²"), tileSize: z.number().default(600).describe("mm square tile"),
      excavation: z.object({ length: z.number(), width: z.number(), depth: z.number(), workingSpace: z.number().default(0) }).optional().describe("m"),
    }),
    run: (inp) => {
      const out: Record<string, unknown> = {};
      const rows: (string | number)[][] = [];
      if (inp.brickworkVolume) {
        const cft = inp.volumeUnit === "cft";
        const r = brickMasonry(cft ? inp.brickworkVolume / CFT_PER_M3 : inp.brickworkVolume, inp.brickType, inp.mortarRatio);
        out.brickwork = r;
        rows.push(["Bricks", `${r.bricks} nos (${r.bricksPerCft.toFixed(1)} per cft + 5% wastage)`], ["Mortar cement", `${r.cement.bags} bags`], ["Mortar sand", cft ? `${r.sand.cft.toFixed(1)} cft` : `${r.sand.m3.toFixed(2)} m³`]);
      }
      if (inp.plasterArea) { const r = plasterQuantity(inp.plasterArea, inp.plasterThickness / 1000, inp.mortarRatio); out.plaster = r; rows.push(["Plaster cement", `${r.cement.bags} bags`], ["Plaster sand", `${r.sand.m3.toFixed(2)} m³`]); }
      if (inp.paintArea) { const r = paintQuantity(inp.paintArea, inp.coats); out.paint = r; rows.push(["Paint", `${r.liters.toFixed(1)} L (${inp.coats} coats)`]); }
      if (inp.tileArea) { const r = tileQuantity(inp.tileArea, { l: inp.tileSize / 1000, w: inp.tileSize / 1000 }); out.tiles = r; rows.push(["Tiles", `${r.tiles} nos (${r.boxesOf4} boxes of 4)`]); }
      if (inp.excavation) { const r = excavation(inp.excavation.length, inp.excavation.width, inp.excavation.depth, inp.excavation.workingSpace); out.excavation = r; rows.push(["Excavation", `${r.volume.toFixed(2)} m³ (loose ${r.loosVolume.toFixed(2)} m³, ~${r.truckTrips6m3} trips of 6 m³)`]); }
      return { result: out, display: { kind: "table", title: "Quantities", columns: ["Item", "Quantity"], rows }, summary: rows.map((r) => `${r[0]}: ${r[1]}`).join("; ") };
    },
  }),
  def({
    name: "earthwork_volume",
    category: "quantities",
    description: "Earthwork volume by average end area, prismoidal formula, grid cut/fill, or trapezoidal channel/road section.",
    schema: z.object({ method: z.enum(["average_end_area", "prismoidal", "grid", "trapezoid"]), areas: z.array(z.number()).optional().describe("cross-section areas m²"), distances: z.array(z.number()).optional().describe("between sections m (average_end_area)"), spacing: z.number().optional().describe("equal spacing m (prismoidal)"), existing: z.array(z.array(z.number())).optional().describe("grid levels m"), proposed: z.array(z.array(z.number())).optional(), cellSize: z.number().optional(), bottomWidth: z.number().optional(), depth: z.number().optional(), sideSlope: z.number().optional().describe("H:1V"), length: z.number().optional() }),
    run: (inp) => {
      let r: unknown; let summary = "";
      if (inp.method === "average_end_area") { const x = averageEndArea(inp.areas!, inp.distances!); r = x; summary = `Volume = ${x.volume.toFixed(2)} m³`; }
      else if (inp.method === "prismoidal") { const x = prismoidal(inp.areas!, inp.spacing!); r = x; summary = `Volume = ${x.volume.toFixed(2)} m³`; }
      else if (inp.method === "grid") { const x = gridCutFill(inp.existing!, inp.proposed!, inp.cellSize!); r = x; summary = `Cut ${x.cut.toFixed(1)} m³, fill ${x.fill.toFixed(1)} m³, net ${x.net.toFixed(1)} m³`; }
      else { const x = trapezoidalSection(inp.bottomWidth!, inp.depth!, inp.sideSlope!, inp.length!); r = x; summary = `Area ${x.area.toFixed(2)} m², volume ${x.volume.toFixed(1)} m³`; }
      return { result: r, summary };
    },
  }),
  def({
    name: "convert_units",
    category: "utility",
    description: `Convert engineering units (incl. Bangladeshi land units: katha = 720 sq ft, decimal/shotangsho = 435.6 sq ft, bigha = 20 katha; cft = ft3, sft = ft2). Categories: ${Object.entries(UNIT_CATALOG).map(([k, v]) => `${k} (${v.join(", ")})`).join("; ")}.`,
    schema: z.object({ value: z.number(), from: z.string(), to: z.string() }),
    run: (inp) => { const r = convert(inp.value, inp.from, inp.to); return { result: { ...r, from: inp.from, to: inp.to, input: inp.value }, summary: `${inp.value} ${inp.from} = ${r.value.toPrecision(6)} ${inp.to}` }; },
  }),
  def({
    name: "calculate",
    category: "utility",
    description: "Evaluate an arithmetic expression exactly (use this instead of mental arithmetic). Supports + - * / ^ %, sqrt, sin/cos/tan (radians) or sind/cosd/tand (degrees), log, exp, pi, e, g, min, max, and named variables.",
    schema: z.object({ expression: z.string(), variables: z.record(z.string(), z.number()).optional() }),
    run: (inp) => { const v = evaluate(inp.expression, inp.variables ?? {}); return { result: { expression: inp.expression, value: v }, summary: `${inp.expression} = ${v}` }; },
  }),
  def({
    name: "search_code_clauses",
    category: "reference",
    description: "Search the built-in building-code knowledge base, Bangladesh (BNBC 2020, RAJUK), India (IS 456/800/875/1893, NBC 2016), China (GB 50010/50009/50011/50007), USA (ACI 318-19, ASCE 7), Pakistan (BCP-SP 2021), Nepal (NBC 105/205), Europe (EN 1990/1991/1992), for clause summaries with clause numbers. Filter by country when the user's location is known. Always cite the returned clause when answering code questions.",
    schema: z.object({ query: z.string(), code: z.string().optional().describe("filter e.g. 'IS 456', 'ACI', 'EN 1992'"), country: z.enum(["Bangladesh", "India", "China", "USA", "Pakistan", "Nepal", "Europe"]).optional(), limit: z.number().default(5) }),
    run: (inp) => { const r = searchCodes(inp.query, { code: inp.code, country: inp.country, limit: inp.limit }); return { result: r.map((c) => ({ id: c.id, code: c.code, clause: c.clause, topic: c.topic, text: c.text })), display: { kind: "table", title: "Code clauses", columns: ["Code", "Clause", "Topic", "Summary"], rows: r.map((c) => [c.code, c.clause, c.topic, c.text]) }, summary: r.length ? r.map((c) => `${c.code} cl. ${c.clause}: ${c.topic}`).join("; ") : "No matching clause in the local knowledge base." }; },
  }),
  def({
    name: "draw_beam_section",
    category: "drawing",
    description: "Generate a 2D RC beam cross-section drawing (DXF-exportable) with rebar, stirrups and dimensions. Units mm.",
    schema: z.object({ b: z.number().positive(), D: z.number().positive(), cover: z.number().default(25), bottomBars: z.object({ count: z.number().int().min(1), dia: z.number() }), topBars: z.object({ count: z.number().int().min(1), dia: z.number() }).optional(), stirrup: z.object({ dia: z.number(), spacing: z.number() }).optional(), title: z.string().optional() }),
    run: (inp) => drawingOut(beamSection(inp), `Beam section ${inp.b}×${inp.D} drawn.`),
  }),
  def({
    name: "draw_beam_elevation",
    category: "drawing",
    description: "Generate an RC beam longitudinal elevation with stirrup zones and bar labels. Units mm.",
    schema: z.object({ span: z.number().positive().describe("mm"), depth: z.number().positive(), supportWidth: z.number().default(300), bottomBars: z.object({ count: z.number().int(), dia: z.number() }), topBars: z.object({ count: z.number().int(), dia: z.number() }).optional(), stirrup: z.object({ dia: z.number(), spacing: z.number(), endSpacing: z.number().optional(), endZone: z.number().optional() }).optional(), title: z.string().optional() }),
    run: (inp) => drawingOut(beamElevation(inp), `Beam elevation drawn.`),
  }),
  def({
    name: "draw_column_section",
    category: "drawing",
    description: "Generate an RC column cross-section drawing with main bars and ties. Units mm.",
    schema: z.object({ b: z.number().positive(), D: z.number().positive(), cover: z.number().default(40), bars: z.object({ count: z.number().int().min(4), dia: z.number() }), tie: z.object({ dia: z.number(), spacing: z.number() }).optional(), title: z.string().optional() }),
    run: (inp) => drawingOut(columnSection(inp), `Column section drawn.`),
  }),
  def({
    name: "draw_footing",
    category: "drawing",
    description: "Generate an isolated square footing plan and section with reinforcement. Units mm.",
    schema: z.object({ side: z.number().positive().describe("mm"), depth: z.number().positive(), columnB: z.number(), columnD: z.number(), bars: z.object({ dia: z.number(), spacing: z.number() }), cover: z.number().default(50), title: z.string().optional() }),
    run: (inp) => drawingOut(footingDrawing(inp), `Footing plan + section drawn.`),
  }),
  def({
    name: "plan_building",
    category: "drawing",
    description: "Building planner for architects/engineers: plot (rectangular, square or irregular polygon), road/front direction, setbacks, building type (single_family, duplex, apartment, shop_house, commercial, office), storeys, bedrooms/bathrooms, garage, shops, windows per room → automatic room programme, one floor plan per storey (DXF-exportable), NBC minimum-size checks, footprint, coverage and FAR. Units m.",
    schema: z.object({
      plot: z.object({ shape: z.enum(["rectangular", "square", "polygon"]).default("rectangular"), width: z.number().positive().optional().describe("m (x)"), depth: z.number().positive().optional().describe("m (y)"), points: z.array(z.tuple([z.number(), z.number()])).optional().describe("polygon corners in m for irregular plots") }),
      frontSide: z.enum(["N", "S", "E", "W"]).default("S").describe("road / entrance side"),
      setback: z.object({ front: z.number().optional(), rear: z.number().optional(), side: z.number().optional() }).optional().describe("m; defaults by plot size"),
      buildingType: z.enum(["single_family", "duplex", "apartment", "shop_house", "commercial", "office"]).default("single_family"),
      storeys: z.number().int().min(1).max(10).default(1),
      bedrooms: z.number().int().min(0).max(8).default(2).describe("per dwelling unit"), bathrooms: z.number().int().min(0).max(6).optional(),
      unitsPerFloor: z.number().int().min(1).max(8).optional().describe("apartments"), shops: z.number().int().min(0).max(20).optional(),
      garage: z.boolean().default(false), dining: z.boolean().default(false), study: z.boolean().default(false), store: z.boolean().default(false),
      windowsPerRoom: z.number().int().min(1).max(2).default(1).describe("windows per habitable room (1 or 2)"),
      wallThickness: z.number().default(230).describe("mm"), corridorWidth: z.number().default(1.2).describe("m"),
      maxCoveragePercent: z.number().optional().describe("default: Dhaka 2025 limit by plot size"), maxFAR: z.number().optional().describe("default: Dhaka 2025 limit by road width"),
      roadWidth: z.number().positive().optional().describe("width of the front road, m (front setback and FAR)"),
      standard: z.enum(["BNBC2020", "NBC2016"]).optional().describe("room-size rules: BNBC 2020 (default, Bangladesh) or NBC 2016 (India)"),
    }),
    run: (inp) => {
      const r = planBuilding(inp);
      // One drawing with all floors side by side.
      const entities: DrawingEntity[] = [];
      let offset = 0;
      for (const f of r.floors) {
        const d = floorPlan({ rooms: f.layout.rooms, wallThickness: inp.wallThickness, title: f.floor.toUpperCase() });
        const w = Math.max(...f.layout.rooms.map((x) => x.x + x.width)) + 3000;
        for (const e of d.entities) entities.push(shiftEntity(e, offset));
        offset += w + 2000;
      }
      const drawing: DrawingModel = { title: `${inp.buildingType.replace("_", " ")}, ${inp.storeys} storey${inp.storeys > 1 ? "s" : ""}`, units: "mm", layers: DEFAULT_LAYERS, entities, notes: r.notes };
      const s = r.summary as { footprint: number; coveragePercent: number; far: number; builtUp: number };
      const failing = r.checks.filter((c) => !c.ok);
      return { result: { summary: r.summary, floors: r.floors.map((f) => ({ floor: f.floor, rooms: f.layout.rooms.filter((x) => !x.open), carpet: f.layout.carpetArea })), checks: r.checks, notes: r.notes }, display: { kind: "drawing", drawing, svg: toSvg(drawing) }, summary: `${r.floors.length} floor plan(s): footprint ${s.footprint.toFixed(1)} m², built-up ${s.builtUp.toFixed(1)} m², coverage ${s.coveragePercent.toFixed(0)}%, FAR ${s.far.toFixed(2)}. ${failing.length ? `${failing.length} check(s) failing: ${failing.slice(0, 3).map((c) => c.name).join("; ")}` : "All checks pass."}` };
    },
  }),
  def({
    name: "plan_layout",
    category: "drawing",
    description: "Space planning: arrange rooms automatically on a plot (with setbacks, wall thickness, corridor) and check NBC 2016 minimum room sizes. Returns room coordinates ready for draw_floor_plan plus built-up area, carpet area, coverage and FAR. Use this instead of inventing coordinates. Units m (areas m²).",
    schema: z.object({
      plotWidth: z.number().positive().describe("m, along x"), plotDepth: z.number().positive().describe("m, along y"),
      rooms: z.array(z.object({ name: z.string(), area: z.number().positive().optional().describe("m²"), width: z.number().positive().optional().describe("m"), length: z.number().positive().optional().describe("m"), kind: z.enum(["habitable", "kitchen", "bath", "wc", "store", "garage", "other"]).optional() })).min(1),
      setback: z.object({ front: z.number().default(0), rear: z.number().default(0), side: z.number().default(0) }).optional().describe("m"),
      wallThickness: z.number().default(230).describe("mm"), corridorWidth: z.number().default(1.2).describe("m; 0 for none"), entrySide: z.enum(["S", "N", "E", "W"]).default("S"), standard: z.enum(["BNBC2020", "NBC2016"]).optional().describe("room-size rules, default BNBC 2020"),
      draw: z.boolean().default(true).describe("also return the floor-plan drawing"), title: z.string().optional(),
    }),
    run: (inp) => {
      const r = planLayout(inp);
      const out: ToolOutput = { result: { rooms: r.rooms.filter((x) => !x.open), builtUpArea: r.builtUpArea, carpetArea: r.carpetArea, coveragePercent: r.coveragePercent, far: r.far, checks: r.checks, notes: r.notes }, summary: `${r.rooms.filter((x) => !x.open).length} rooms arranged; footprint ${r.builtUpArea.toFixed(1)} m² (coverage ${r.coveragePercent.toFixed(0)}%, FAR ${r.far.toFixed(2)}), carpet ${r.carpetArea.toFixed(1)} m². ${r.checks.filter((c) => !c.ok).length ? `Checks failing: ${r.checks.filter((c) => !c.ok).map((c) => c.name.split(":")[0]).join(", ")}` : "All NBC minimum-size checks pass."}` };
      if (inp.draw) { const d = floorPlan({ rooms: r.rooms, wallThickness: inp.wallThickness, title: inp.title ?? `FLOOR PLAN, PLOT ${inp.plotWidth}×${inp.plotDepth} m` }); d.notes = [...(d.notes ?? []), ...r.notes]; out.display = { kind: "drawing", drawing: d, svg: toSvg(d) }; }
      else out.display = { kind: "steps", title: "Layout checks", steps: r.notes, checks: r.checks };
      return out;
    },
  }),
  def({
    name: "plot_stats",
    category: "utility",
    description: "Plot coverage and FAR/FSI: given plot area, footprint and floors, compute coverage %, FAR, and compare with allowed limits.",
    schema: z.object({ plotArea: z.number().positive().describe("m²"), footprint: z.number().positive().describe("m² per floor"), floors: z.number().int().positive(), maxCoveragePercent: z.number().optional(), maxFAR: z.number().optional() }),
    run: (inp) => { const r = plotStats(inp.plotArea, inp.floors, inp.footprint, inp.maxCoveragePercent, inp.maxFAR); return { result: r, summary: `Coverage ${r.coveragePercent.toFixed(1)}%${r.coverageOk === undefined ? "" : r.coverageOk ? " ✓" : " ✗"}, FAR ${r.far.toFixed(2)}${r.farOk === undefined ? "" : r.farOk ? " ✓" : " ✗"}, built-up ${r.builtUp.toFixed(1)} m²` }; },
  }),
  def({
    name: "draw_floor_plan",
    category: "drawing",
    description: "Generate a simple architectural floor plan from a list of rooms (rectangles with internal dimensions in mm, positioned by their bottom-left corner). Doors/windows optionally on N/S/E/W walls.",
    schema: z.object({ rooms: z.array(z.object({ name: z.string(), x: z.number(), y: z.number(), width: z.number().positive(), length: z.number().positive(), door: z.enum(["N", "S", "E", "W"]).optional(), window: z.enum(["N", "S", "E", "W"]).optional() })).min(1), wallThickness: z.number().default(230), title: z.string().optional() }),
    run: (inp) => drawingOut(floorPlan(inp), `Floor plan with ${inp.rooms.length} rooms drawn.`),
  }),
  def({
    name: "draw_custom",
    category: "drawing",
    description: "Draw arbitrary 2D geometry (lines, polylines, circles, arcs, text, dimensions, hatches) in mm on named layers (OUTLINE, REBAR, STIRRUP, DIM, TEXT, HATCH, CENTER, WALL, DOOR, WINDOW). Use for details not covered by the templates. Y axis points up.",
    schema: z.object({
      title: z.string(),
      units: z.enum(["mm", "m"]).default("mm"),
      entities: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal("line"), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), layer: z.string().optional() }),
        z.object({ type: z.literal("polyline"), points: z.array(z.tuple([z.number(), z.number()])).min(2), closed: z.boolean().optional(), layer: z.string().optional() }),
        z.object({ type: z.literal("circle"), cx: z.number(), cy: z.number(), r: z.number().positive(), layer: z.string().optional() }),
        z.object({ type: z.literal("arc"), cx: z.number(), cy: z.number(), r: z.number().positive(), startAngle: z.number(), endAngle: z.number(), layer: z.string().optional() }),
        z.object({ type: z.literal("text"), x: z.number(), y: z.number(), text: z.string(), height: z.number().optional(), rotation: z.number().optional(), align: z.enum(["left", "center", "right"]).optional(), layer: z.string().optional() }),
        z.object({ type: z.literal("dimension"), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), offset: z.number().describe("perpendicular offset of dimension line"), text: z.string().optional(), layer: z.string().optional() }),
        z.object({ type: z.literal("hatch"), points: z.array(z.tuple([z.number(), z.number()])).min(3), pattern: z.enum(["concrete", "earth", "steel", "solid"]).optional(), spacing: z.number().optional(), layer: z.string().optional() }),
      ])).min(1),
      notes: z.array(z.string()).optional(),
    }),
    run: (inp) => drawingOut({ title: inp.title, units: inp.units, layers: DEFAULT_LAYERS, entities: inp.entities, notes: inp.notes }, `Drawing "${inp.title}" created with ${inp.entities.length} entities.`),
  }),
];

function shiftEntity(e: DrawingEntity, dx: number): DrawingEntity {
  switch (e.type) {
    case "line": case "dimension": return { ...e, x1: e.x1 + dx, x2: e.x2 + dx };
    case "polyline": case "hatch": return { ...e, points: e.points.map(([x, y]) => [x + dx, y] as [number, number]) };
    case "circle": case "arc": return { ...e, cx: e.cx + dx };
    case "text": return { ...e, x: e.x + dx };
  }
}

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** Always-available small tools. */
const CORE_TOOLS = ["calculate", "convert_units", "search_code_clauses"];
const TOOL_GROUPS: { keys: RegExp; tools: string[] }[] = [
  { keys: /\b(beam|girder|lintel|joist|purlin|udl|point load|bending|shear|deflect|moment|cantilever|span)\b|বিম|বীম/i, tools: ["analyze_beam", "design_rc_beam", "design_steel_beam", "draw_beam_section", "draw_beam_elevation"] },
  { keys: /\b(column|pillar|post|axial|strut)\b|কলাম/i, tools: ["design_rc_column", "draw_column_section"] },
  { keys: /\b(slab|floor plate|roof slab|deck)\b|স্ল্যাব|ছাদ/i, tools: ["design_one_way_slab"] },
  { keys: /\b(footing|foundation|soil|bearing|sbc|terzaghi|retaining|earth pressure|pile|settle\w*|consolidat\w*|spt|clay|sand)\b|ফাউন্ডেশন|ফুটিং|পাইল|মাটি/i, tools: ["bearing_capacity", "settlement", "earth_pressure", "design_isolated_footing", "draw_footing"] },
  { keys: /\b(steel|ismb|w-?shape|section|rolled)\b/i, tools: ["design_steel_beam", "analyze_beam"] },
  { keys: /\b(quantit|estimat|boq|bill|cement|sand|aggregate|stone chip|khoa|bag|brick|block|masonry|plaster|paint|tile|excavat|earthwork|cut|fill|volume|rebar|rods?\b|steel weight|bar bending|bbs|material)|সিমেন্ট|বালি|খোয়া|পাথর|ইট|রড|ঢালাই|প্লাস্টার/i, tools: ["concrete_materials", "rebar_schedule", "masonry_and_finishes", "earthwork_volume"] },
  { keys: /\b(plan|room|layout|house|flat|apartment|villa|duplex|storey|story|stories|shop|mall|office|floor plan|bedroom|kitchen|architect|plot|setback|far|fsi|coverage|katha|bigha)\b|বাড়ি|বাড়ি|ফ্ল্যাট|নকশা|প্ল্যান|কাঠা|বিঘা|তলা/i, tools: ["plan_building", "plan_layout", "plot_stats", "draw_floor_plan", "draw_custom"] },
  { keys: /\b(draw|drawing|sketch|detail|section|elevation|dxf|cad)\b/i, tools: ["draw_custom", "draw_beam_section", "draw_column_section", "draw_footing", "draw_floor_plan"] },
];

/**
 * Pick the tool set relevant to the conversation. Every model call re-sends all tool schemas (~6.7K tokens for all
 * of them), so routing cuts cost for cloud models and keeps requests under free-tier token limits; on CPU-only PCs
 * it also makes local models much faster. Falls back to all tools when nothing matches.
 */
export function selectToolsForText(text: string): ToolDef[] {
  const names = new Set(CORE_TOOLS);
  let matched = false;
  for (const g of TOOL_GROUPS) if (g.keys.test(text)) { matched = true; g.tools.forEach((n) => names.add(n)); }
  if (!matched) return TOOLS;
  return TOOLS.filter((t) => names.has(t.name));
}

/** JSON schema for LLM function calling. `strict` removes formats Gemini rejects. */
export function toolJsonSchema(t: ToolDef, flavor: "anthropic" | "openai" | "gemini" = "openai"): Record<string, unknown> {
  const js = normalizeSchema(z.toJSONSchema(t.schema, { target: "draft-7", io: "input" })) as Record<string, unknown>;
  delete js.$schema;
  if (flavor === "gemini") return stripForGemini(js) as Record<string, unknown>;
  return js;
}

/**
 * Make schemas portable across providers: draft-7 tuples (`items: [a, b]`) and `prefixItems` are rejected by Gemini and by
 * Groq's 2020-12 validator, so turn them into a single `items` schema with a fixed length (e.g. [x, y] coordinate pairs).
 */
export function normalizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (!node || typeof node !== "object") return node;
  const o = { ...(node as Record<string, unknown>) };
  const tuple = Array.isArray(o.items) ? (o.items as unknown[]) : Array.isArray(o.prefixItems) ? (o.prefixItems as unknown[]) : null;
  if (tuple) {
    const parts = tuple.map(normalizeSchema);
    const same = parts.every((p) => JSON.stringify(p) === JSON.stringify(parts[0]));
    o.items = same ? parts[0] : { anyOf: parts };
    o.minItems = o.minItems ?? parts.length;
    o.maxItems = o.maxItems ?? parts.length;
    delete o.prefixItems;
    delete o.additionalItems;
  }
  for (const [k, v] of Object.entries(o)) if (k !== "items" || !tuple) o[k] = normalizeSchema(v);
  return o;
}

function stripForGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripForGemini);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (["additionalProperties", "$schema", "default", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "const"].includes(k)) continue;
      if (k === "oneOf" || k === "anyOf") { out[k] = (v as unknown[]).map(stripForGemini); continue; }
      if (k === "prefixItems") { out.items = stripForGemini((v as unknown[])[0]); continue; }
      out[k] = stripForGemini(v);
    }
    // Gemini only supports enums of strings: keep string literals as a one-value enum, drop numeric/boolean literals to their type.
    if (typeof o.const === "string") { out.type = "string"; out.enum = [o.const]; }
    else if (o.const !== undefined && !out.type) out.type = typeof o.const === "number" ? "number" : "boolean";
    if (o.type === "integer") out.type = "integer";
    return out;
  }
  return node;
}

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; anyOf?: JsonSchema[]; oneOf?: JsonSchema[] };

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/**
 * Make model-produced inputs robust: rename near-miss keys (case, one-letter typos such as "Mb"→"Mu"),
 * coerce numeric strings to numbers, recurse into nested objects/arrays. Small local models need this.
 */
export function normalizeInput(schema: JsonSchema, raw: unknown): unknown {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants && raw && typeof raw === "object" && !Array.isArray(raw)) {
    // discriminated union: pick the variant whose "type" const/enum matches, else first object variant
    const r = raw as Record<string, unknown>;
    const v = variants.find((x) => { const tp = x.properties?.type as { const?: unknown; enum?: unknown[] } | undefined; return tp && (tp.const === r.type || tp.enum?.includes(r.type)); }) ?? variants.find((x) => x.properties) ?? variants[0];
    return normalizeInput(v, raw);
  }
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === "object" && schema.properties && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const props = schema.properties;
    const names = Object.keys(props);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      let key = k;
      if (!(k in props)) {
        const ci = names.find((n) => n.toLowerCase() === k.toLowerCase() && !(n in (raw as object)));
        const near = ci ?? names.find((n) => n.length > 1 && editDistance(n.toLowerCase(), k.toLowerCase()) <= 1 && !(n in (raw as object)));
        if (near) key = near;
      }
      out[key] = key in props ? normalizeInput(props[key], v) : v;
    }
    return out;
  }
  if (t === "array" && Array.isArray(raw) && schema.items) return raw.map((x) => normalizeInput(schema.items!, x));
  if ((t === "number" || t === "integer") && typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  if (t === "boolean" && typeof raw === "string") return raw === "true";
  return raw;
}

export async function runTool(name: string, rawInput: unknown): Promise<ToolOutput & { error?: string }> {
  const t = TOOL_MAP.get(name);
  if (!t) return { result: null, error: `Unknown tool ${name}. Available: ${TOOLS.map((x) => x.name).join(", ")}` };
  const js = toolJsonSchema(t, "openai") as JsonSchema;
  const input = normalizeInput(js, rawInput);
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) {
    const expected = Object.entries(js.properties ?? {}).map(([k, v]) => `${k}${js.required?.includes(k) ? "*" : ""} (${Array.isArray(v.type) ? v.type[0] : v.type ?? "object"})`).join(", ");
    return { result: null, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Expected parameters (exact names, * = required): ${expected}` };
  }
  try {
    return await t.run(parsed.data);
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}
