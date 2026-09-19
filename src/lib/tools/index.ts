/**
 * Tool registry: every calculator/drawing the AI agent (and the Calculators UI) can call.
 * Each tool has a zod schema (→ JSON schema for the LLM), a deterministic run(), and an optional
 * rich display payload the chat UI knows how to render (charts, drawings, tables).
 */
import { z } from "zod";
import { analyzeBeam, rectI, type BeamResult } from "@/lib/eng/beam";
import { convert, UNIT_CATALOG } from "@/lib/eng/units";
import { designRcBeam, designOneWaySlab, designIsolatedFooting, beamCapacity } from "@/lib/eng/rc";
import { drawingToInches, usLabel, feetInches } from "@/lib/drawing/units";
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
import type { WorkbookSpec, CellSpec } from "@/lib/docs/workbook";
import { costEstimate, estimateWorkbook } from "@/lib/eng/estimate";
import { projectSchedule, scheduleWorkbook } from "@/lib/eng/schedule";
import { MIX_TOOLS } from "./mix-tools";
import { subdivide } from "@/lib/eng/subdivision";
import { plantsForArea, plantsForRow, bulkMaterial, waterBudget, sprinkler } from "@/lib/eng/landscape";
import { PAVEMENT_TOOLS } from "./pavement-tools";
import { ROAD_TOOLS } from "./road-tools";
import { rationalMethod, kirpich, manningQ, normalDepth, sizePipe, type Section } from "@/lib/eng/drainage";

export type Display =
  | { kind: "beam"; result: BeamResult }
  | { kind: "drawing"; drawing: Drawing; svg: string }
  | { kind: "table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | { kind: "steps"; title?: string; steps: string[]; checks?: { name: string; ok: boolean; detail: string }[] };

/** workbook: an Excel spec the chat offers as a download (sent to the browser only, never to the model). */
export interface ToolOutput { result: unknown; display?: Display; summary?: string; workbook?: WorkbookSpec; drawing?: { drawing: Drawing; svg: string } }

/** Drawing of a designed member, attached to design results so the DXF can be opened in AutoCAD straight away. */
const designDrawing = (d: Drawing) => ({ drawing: d, svg: toSvg(d) });
const num = (label: string | undefined, re: RegExp) => { const m = label ? re.exec(label) : null; return m ? Number(m[1]) : undefined; };

// ---------- US customary inputs: converted to the engines' SI units at the boundary ----------
const US_UNITS = { in: [25.4, "in", "mm"], ft: [0.3048, "ft", "m"], ftmm: [304.8, "ft", "mm"], psi: [0.00689476, "psi", "MPa"], ksi: [6.89476, "ksi", "MPa"], kip: [4.448222, "kip", "kN"], kipft: [1.355818, "kip-ft", "kN·m"], klf: [14.5939, "kip/ft", "kN/m"], psf: [0.0478803, "psf", "kPa"], ksf: [47.8803, "ksf", "kPa"], pcf: [0.157087, "pcf", "kN/m³"] } as const;
type UsKind = keyof typeof US_UNITS;
const UNITS_FIELD = z.enum(["SI", "US"]).default("SI").describe("SI: mm, m, MPa, kN, kN·m, kPa, kN/m³. US: in, ft, psi (f'c), ksi (fy), kip, kip-ft, kip/ft, psf/ksf, pcf; US bars #3–#11 are given as bar numbers (5 = #5)");
const sig = (x: number) => Number(x.toPrecision(4));
/** Convert the listed US inputs to SI (f'c typed in ksi or fy in psi are recognised) and describe the conversion. */
function fromUS<T extends Record<string, unknown>>(inp: T, spec: Partial<Record<string, UsKind>>): { si: T; note: string | null; us: boolean } {
  if (inp.units !== "US") return { si: inp, note: null, us: false };
  const si: Record<string, unknown> = { ...inp };
  const parts: string[] = [];
  for (const [k, kind] of Object.entries(spec)) {
    let v = inp[k];
    if (typeof v !== "number" || !kind) continue;
    if (kind === "psi" && v < 20) v *= 1000; // 4 → 4000 psi
    if (kind === "ksi" && v > 1000) v /= 1000; // 60000 → 60 ksi
    const [f, u, su] = US_UNITS[kind];
    si[k] = v * f;
    parts.push(`${k} ${v} ${u} = ${sig(v * f)} ${su}`);
  }
  return { si: si as T, note: parts.length ? `US inputs converted to SI for the calculation: ${parts.join("; ")}.` : null, us: true };
}
const inch = (mm: number, dp = 2) => `${(mm / 25.4).toFixed(dp)} in`;
const kipft = (kNm: number) => `${(kNm / 1.355818).toFixed(1)} kip-ft`;
const in2 = (mm2: number) => `${(mm2 / 645.16).toFixed(2)} in²`;

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  category: "analysis" | "design" | "geotech" | "transport" | "water" | "site" | "materials" | "quantities" | "management" | "drawing" | "reference" | "utility";
  description: string;
  schema: S;
  run: (input: z.infer<S>) => ToolOutput | Promise<ToolOutput>;
}

const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t as unknown as ToolDef;

/** Plot boundary in any real-life shape (see eng/plot.ts). Edge 0 is the road (front) edge unless roadEdges says otherwise. */
const plotCommon = { units: z.enum(["m", "ft"]).default("m").describe("units of the plot dimensions"), roadEdges: z.array(z.number().int().min(0)).optional().describe("edges facing a road (0 = first edge); corner plots have two") };
const PLOT_SCHEMA = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("rectangular"), width: z.number().positive().describe("along the road"), depth: z.number().positive().describe("away from the road"), ...plotCommon }),
  z.object({ shape: z.literal("square"), side: z.number().positive(), ...plotCommon }),
  z.object({ shape: z.literal("trapezoid"), frontWidth: z.number().positive().describe("road side"), rearWidth: z.number().positive(), depth: z.number().positive(), rearOffset: z.number().optional().describe("rear-left corner offset from front-left, default centred"), ...plotCommon }),
  z.object({ shape: z.literal("quadrilateral"), front: z.number().positive().describe("road side"), right: z.number().positive(), rear: z.number().positive(), left: z.number().positive(), diagonal: z.number().positive().describe("front-left to rear-right corner"), ...plotCommon }).describe("irregular four-sided plot measured as four sides and one diagonal"),
  z.object({ shape: z.literal("l_shape"), width: z.number().positive(), depth: z.number().positive(), cutWidth: z.number().positive().describe("missing corner width"), cutDepth: z.number().positive().describe("missing corner depth"), cutCorner: z.enum(["rear_right", "rear_left", "front_right", "front_left"]).default("rear_right"), ...plotCommon }),
  z.object({ shape: z.literal("triangle"), front: z.number().positive().describe("road side"), right: z.number().positive(), left: z.number().positive(), ...plotCommon }),
  z.object({ shape: z.literal("corner_cut"), width: z.number().positive(), depth: z.number().positive(), chamfer: z.number().positive().describe("corner splay length along each side"), corner: z.enum(["front_right", "front_left"]).default("front_right"), ...plotCommon }).describe("corner plot with a cut (splayed) corner at the road junction"),
  z.object({ shape: z.literal("flag"), poleWidth: z.number().positive().describe("access strip width"), poleLength: z.number().positive().describe("access strip length"), flagWidth: z.number().positive(), flagDepth: z.number().positive(), pole: z.enum(["left", "right"]).default("left"), ...plotCommon }).describe("flag / panhandle lot reached by an access strip"),
  z.object({ shape: z.literal("polygon"), points: z.array(z.tuple([z.number(), z.number()])).min(3).describe("corner coordinates x, y in order around the plot"), frontEdge: z.number().int().min(0).default(0).describe("edge facing the road (0 = first to second corner)"), ...plotCommon }).describe("custom boundary from corner coordinates"),
  z.object({ shape: z.literal("traverse"), legs: z.array(z.object({ length: z.number().positive(), bearing: z.string().describe("e.g. N 45°30' E, S12W or azimuth 135.5") })).min(3).describe("boundary legs in order, as on a survey plan"), frontEdge: z.number().int().min(0).default(0), ...plotCommon }).describe("custom boundary from a survey traverse of lengths and bearings"),
]);

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
      units: UNITS_FIELD,
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      b: z.number().positive().describe("width mm"), D: z.number().positive().describe("overall depth mm"),
      cover: z.number().optional().describe("clear cover to stirrups mm (default 40 BNBC/ACI, 25 IS)"),
      fck: z.number().positive().describe("concrete strength MPa: f'c for BNBC/ACI, fck for IS"), fy: z.number().positive().describe("main steel yield MPa"),
      fyStirrup: z.number().optional().describe("stirrup yield MPa (default = fy; capped at 420 BNBC/ACI, 415 IS)"),
      Mu: z.number().positive().describe("factored moment kN·m"), Vu: z.number().optional().describe("factored shear kN"),
      stirrupDia: z.number().optional().describe("mm (US: bar number, default #3)"), mainBarDia: z.number().optional().describe("mm, default 16 (US: bar number, default 6)"),
      span: z.number().optional().describe("m, for the depth/deflection check"), support: z.enum(["simply_supported", "one_end_continuous", "both_ends_continuous", "cantilever"]).optional(),
    }),
    run: (inp) => {
      const { si, note, us } = fromUS(inp, { b: "in", D: "in", cover: "in", fck: "psi", fy: "ksi", fyStirrup: "ksi", Mu: "kipft", Vu: "kip", span: "ft" });
      const r = designRcBeam({ ...si, barSystem: us ? "US" : "metric" });
      const tb = r.tensionBars[0], cb = r.compressionBars?.[0];
      const sDia = r.shear ? num(r.shear.stirrupLabel, /Ø(\d+(?:\.\d+)?)/) ?? (us ? num(r.shear.stirrupLabel, /#(\d+)/) : undefined) : undefined;
      const stirDiaMm = sDia !== undefined && us && /#/.test(r.shear?.stirrupLabel ?? "") ? { 3: 9.525, 4: 12.7, 5: 15.875 }[sDia] ?? 9.525 : sDia;
      const topNote = cb ? `Top: ${cb.label} (compression steel)` : us ? "Top: 2 #4 hanger bars (nominal, not designed)" : "Top: 2 × Ø12 hanger bars (nominal, not designed)";
      let dwg = tb ? beamSection({ b: si.b, D: si.D, cover: si.cover ?? (r.code === "IS456" ? 25 : 40), bottomBars: { count: tb.count, dia: tb.diameter }, topBars: cb ? { count: cb.count, dia: cb.diameter } : { count: 2, dia: us ? 12.7 : 12 }, stirrup: r.shear && stirDiaMm ? { dia: stirDiaMm, spacing: r.shear.stirrupSpacing } : undefined, title: `RC BEAM ${inp.b} x ${inp.D}${us ? " in" : ""} (${r.code})`, notes: [`Bottom: ${tb.label}`, topNote, ...(r.shear ? [`Stirrups: ${r.shear.stirrupLabel}`] : []), "Preliminary design: check and detail per the applicable code."] }) : undefined;
      if (dwg && us) dwg = drawingToInches(dwg);
      const shear = r.shear ? (us ? usLabel(r.shear.stirrupLabel) : r.shear.stirrupLabel) : "";
      const summary = us
        ? `${r.code}: As = ${in2(r.AstRequired)} → ${tb?.label ?? "increase section"}${r.AscRequired > 0 ? `; compression steel ${in2(r.AscRequired)} → ${cb?.label ?? ""}` : ""}${shear ? `; ${shear}` : ""}`
        : `${r.code}: As = ${r.AstRequired.toFixed(0)} mm² → ${tb?.label ?? "increase section"}${r.AscRequired > 0 ? `; compression steel ${r.AscRequired.toFixed(0)} mm² → ${cb?.label ?? ""}` : ""}${shear ? `; ${shear}` : ""}`;
      return { result: r, display: { kind: "steps", title: `RC beam ${inp.b}×${inp.D}${us ? " in" : ""} (${r.code})`, steps: [...(note ? [note] : []), ...r.steps], checks: r.checks }, drawing: dwg ? designDrawing(dwg) : undefined, summary };
    },
  }),
  def({
    name: "rc_beam_capacity",
    category: "design",
    description: "Flexural capacity of a GIVEN rectangular RC beam section (analysis, not design): from b, d (or D), the steel As or bars, f'c/fck and fy, returns a, c, net tensile strain εt, φ, Mn and φMn (ACI 318 / BNBC 2020) or Mu,R (IS 456), with minimum-steel, ductility and optional Mu checks, all steps in one call. Use this for 'find the moment capacity / is this beam adequate' questions instead of step-by-step calculate calls.",
    schema: z.object({
      units: UNITS_FIELD,
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      b: z.number().positive().describe("width mm (US: in)"), d: z.number().positive().optional().describe("effective depth mm (US: in); or give D"),
      D: z.number().positive().optional().describe("overall depth mm (US: in), used when d is not given"), cover: z.number().optional().describe("clear cover mm (US: in)"),
      As: z.number().positive().optional().describe("tension steel area mm² (US: in²); or give bars"),
      bars: z.object({ count: z.number().int().min(1), dia: z.number().positive().describe("mm (US: bar number, e.g. 8 = #8)") }).optional(),
      fck: z.number().positive().describe("f'c MPa (US: psi) for ACI/BNBC, fck for IS"), fy: z.number().positive().describe("MPa (US: ksi)"),
      Mu: z.number().optional().describe("factored moment to check, kN·m (US: kip-ft)"),
    }),
    run: (inp0) => {
      const { si: inp, note, us } = fromUS(inp0, { b: "in", d: "in", D: "in", cover: "in", fck: "psi", fy: "ksi", Mu: "kipft" });
      const As = us && inp0.As !== undefined ? inp0.As * 645.16 : inp.As;
      const r = beamCapacity({ ...inp, As, barSystem: us ? "US" : "metric" });
      const aci = r.code !== "IS456";
      const M = (kNm: number) => (us ? `${kipft(kNm)} (${kNm.toFixed(1)} kN·m)` : `${kNm.toFixed(1)} kN·m`);
      const summary = aci
        ? `${r.code}: a = ${us ? inch(r.a ?? 0) : `${r.a?.toFixed(1)} mm`}, c = ${us ? inch(r.c) : `${r.c.toFixed(1)} mm`}, εt = ${r.et?.toFixed(4)}, φ = ${r.phi.toFixed(2)}; Mn = ${M(r.Mn)}; φMn = ${M(r.phiMn)}${r.ok ? "; all checks pass" : "; CHECK FAILS: " + r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`
        : `IS 456: xu = ${r.c.toFixed(1)} mm; Mu,R = ${M(r.Mn)}${r.ok ? "; all checks pass" : "; CHECK FAILS: " + r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`;
      return { result: r, display: { kind: "steps", title: `Flexural capacity ${inp0.b} × ${inp0.d ?? inp0.D}${us ? " in" : " mm"} (${r.code})`, steps: [...(note ? [note] : []), ...r.steps], checks: r.checks }, summary };
    },
  }),
  def({
    name: "design_rc_column",
    category: "design",
    description: "Design or check a rectangular tied RC column for axial load with uniaxial or biaxial moments, by strain compatibility (interaction diagram), including slenderness (moment magnification for braced frames) and minimum eccentricity. Codes: BNBC2020 (default), ACI318, IS456. Finds the lightest bar arrangement if bars are not given. Inputs mm, MPa, kN, kN·m.",
    schema: z.object({
      units: UNITS_FIELD,
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
    run: (inp0) => {
      const { si: inp, note, us } = fromUS(inp0, { b: "in", D: "in", fck: "psi", fy: "ksi", Pu: "kip", Mux: "kipft", Muy: "kipft", unsupportedLength: "ftmm", clearCover: "in" });
      const r = designColumn({ code: inp.code, b: inp.b, h: inp.D, fc: inp.fck, fy: inp.fy, Pu: inp.Pu, Mux: inp.Mux, Muy: inp.Muy, lu: inp.unsupportedLength, k: inp.k, braced: inp.braced, endMomentRatio: inp.endMomentRatio, curvature: inp.curvature, bars: inp.bars, clearCover: inp.clearCover , barSystem: us ? "US" : "metric" });
      const { curve: _c, ...rest } = r; void _c;
      const tie = /(?:Ø(\d+(?:\.\d+)?)|#(\d+)) ties @ (\d+)/.exec(r.ties ?? "");
      const tieDia = tie ? (tie[1] ? Number(tie[1]) : ({ 3: 9.525, 4: 12.7 } as Record<string, number>)[tie[2]] ?? 9.525) : undefined;
      let dwg = columnSection({ b: inp.b, D: inp.D, cover: inp.clearCover ?? 40, bars: { count: r.bars.count, dia: r.bars.dia }, tie: tie && tieDia ? { dia: tieDia, spacing: Number(tie[3]) } : undefined, title: `RC COLUMN ${inp0.b} x ${inp0.D}${us ? " in" : ""} (${r.code})` });
      if (us) dwg = drawingToInches(dwg);
      const summary = us ? `${r.code}: ${r.bars.label} (${in2(r.bars.area)}, ${r.bars.percent.toFixed(2)}%), ${usLabel(r.ties)}; ${r.ok ? "all checks pass" : "CHECKS FAIL: " + r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}` : `${r.code}: ${r.bars.label} (${r.bars.area.toFixed(0)} mm², ${r.bars.percent.toFixed(2)}%), ${r.ties}; ${r.ok ? "all checks pass" : "CHECKS FAIL: " + r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`;
      return { result: { ...rest, AscRequired: r.bars.area, steelPercent: r.bars.percent }, display: { kind: "steps", title: `RC column ${inp0.b}×${inp0.D}${us ? " in" : ""} (${r.code})`, steps: [...(note ? [note] : []), ...r.steps], checks: r.checks }, drawing: designDrawing(dwg), summary };
    },
  }),
  def({
    name: "design_one_way_slab",
    category: "design",
    description: "Design a one-way RC slab: thickness (deflection), bottom and top bars, distribution bars, shear check. Codes: BNBC2020 (default), ACI318, IS456. Supports: simply supported, end span (one end continuous), interior span (both ends continuous), cantilever. Units m, kN/m², MPa.",
    schema: z.object({
      units: UNITS_FIELD,
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      span: z.number().positive().describe("effective span m"), liveLoad: z.number().nonnegative().describe("kN/m²"),
      floorFinish: z.number().optional().describe("kN/m² (US: psf), default 1 kN/m² (≈ 21 psf)"), partitionLoad: z.number().optional().describe("extra dead load kN/m² (US: psf)"),
      fck: z.number().positive(), fy: z.number().positive(), cover: z.number().optional().describe("mm (US: in), default 20 mm"),
      support: z.enum(["simply_supported", "one_end_continuous", "both_ends_continuous", "cantilever"]).default("simply_supported"),
      thickness: z.number().optional().describe("mm override (US: in)"), barDia: z.number().optional().describe("main bar mm, default 10 (US: bar number, default 4)"),
      brickAggregate: z.boolean().optional().describe("brick-chip (khoa) aggregate concrete: 1.5× minimum steel under BNBC"),
    }),
    run: (inp) => {
      const { si, note, us } = fromUS(inp, { span: "ft", liveLoad: "psf", floorFinish: "psf", partitionLoad: "psf", fck: "psi", fy: "ksi", cover: "in", thickness: "in" });
      const r = designOneWaySlab({ ...si, barSystem: us ? "US" : "metric" });
      const t = (x: string) => (us ? usLabel(x) : x);
      const h = us ? `${inch(r.thickness)} (${r.thickness} mm; use ${Math.ceil((r.thickness / 25.4) * 2) / 2} in)` : `${r.thickness} mm`;
      return { result: r, display: { kind: "steps", title: `One-way slab, span ${inp.span} ${us ? "ft" : "m"} (${r.code})`, steps: [...(note ? [note] : []), ...r.steps], checks: r.checks }, summary: `${r.code}: h = ${h}; ${t(r.mainBars)}${r.topBars ? `; ${t(r.topBars)}` : ""}; distribution ${t(r.distributionBars)}` };
    },
  }),
  def({
    name: "design_isolated_footing",
    category: "design",
    description: "Size and design a square isolated RC footing: plan size from allowable bearing, depth from one-way and punching shear, bottom bars, development length and column bearing. Codes: BNBC2020 (default), ACI318, IS456. Give dead and live loads separately when known. Units mm, kN, kN/m², MPa.",
    schema: z.object({
      units: UNITS_FIELD,
      code: z.enum(["BNBC2020", "ACI318", "IS456"]).default("BNBC2020"),
      columnB: z.number().positive().describe("mm"), columnD: z.number().positive().describe("mm"),
      serviceLoad: z.number().positive().optional().describe("total unfactored column load kN (if dead/live not given)"),
      deadLoad: z.number().nonnegative().optional().describe("unfactored dead load kN"), liveLoad: z.number().nonnegative().optional().describe("unfactored live load kN"),
      safeBearingCapacity: z.number().positive().describe("allowable net bearing pressure kN/m²"),
      fck: z.number().positive(), fy: z.number().positive(),
      cover: z.number().optional().describe("mm, default 75 BNBC/ACI, 50 IS (US: in)"), barDia: z.number().optional().describe("mm, default 16 (US: bar number, default 5)"),
      brickAggregate: z.boolean().optional(),
    }),
    run: (inp0) => {
      const { si: inp, note, us } = fromUS(inp0, { columnB: "in", columnD: "in", serviceLoad: "kip", deadLoad: "kip", liveLoad: "kip", safeBearingCapacity: "ksf", fck: "psi", fy: "ksi", cover: "in" });
      const r = designIsolatedFooting({ ...inp, barSystem: us ? "US" : "metric" });
      const fb = /(?:Ø(\d+(?:\.\d+)?)|#(\d+)) @ (\d+)/.exec(r.bars);
      const fbDia = fb ? (fb[1] ? Number(fb[1]) : ({ 3: 9.525, 4: 12.7, 5: 15.875, 6: 19.05, 7: 22.225, 8: 25.4, 9: 28.65, 10: 32.26, 11: 35.81 } as Record<string, number>)[fb[2]]) : undefined;
      let dwg = fb && fbDia ? footingDrawing({ side: Math.round(r.side * 1000), depth: r.depth, columnB: inp.columnB, columnD: inp.columnD, bars: { dia: fbDia, spacing: Number(fb[3]) }, cover: inp.cover ?? (r.code === "IS456" ? 50 : 75), title: `FOOTING ${us ? `${feetInches((r.side * 1000) / 25.4)} SQUARE` : `${r.side} x ${r.side} m`} (${r.code})` }) : undefined;
      if (dwg && us) dwg = drawingToInches(dwg);
      const summary = us ? `${r.code}: ${feetInches((r.side * 1000) / 25.4)} square × ${inch(r.depth, 1)} deep (${r.side} m × ${r.depth} mm); ${usLabel(r.bars)}` : `${r.code}: ${r.side} × ${r.side} m × ${r.depth} mm; ${r.bars}`;
      return { result: r, display: { kind: "steps", title: `Isolated footing ${r.side}×${r.side} m (${r.code})`, steps: [...(note ? [note] : []), ...r.steps], checks: r.checks }, drawing: dwg ? designDrawing(dwg) : undefined, summary };
    },
  }),
  def({
    name: "design_steel_beam",
    category: "design",
    description: "Select or check a rolled steel I-section (ISMB per IS 808:2021, or AISC W-shape) for a simply supported beam or cantilever per IS 800:2007 or AISC 360-16 (LRFD): bending with lateral-torsional buckling when the compression flange is unbraced (give unbracedLength), section class, web shear with high-shear reduction, and deflection. Units m, kN, kN/m, kN·m, MPa.",
    schema: z.object({ units: UNITS_FIELD, code: z.enum(["IS800", "AISC"]).default("IS800"), span: z.number().positive().describe("m (US: ft)"), support: z.enum(["simply_supported", "cantilever"]).default("simply_supported"), factoredUDL: z.number().optional().describe("kN/m"), factoredPointLoad: z.number().optional().describe("kN at midspan (SS) or at the tip (cantilever)"), serviceUDL: z.number().optional().describe("kN/m unfactored, for deflection"), servicePointLoad: z.number().optional().describe("kN unfactored, for deflection"), factoredMoment: z.number().optional().describe("kN·m, overrides loads"), fy: z.number().optional(), section: z.string().optional().describe(`check a specific section, e.g. ${SECTIONS.slice(0, 3).map((s) => s.name).join(", ")}`), deflectionLimit: z.number().optional().describe("span/N, default 300 SS or 150 cantilever") , unbracedLength: z.number().positive().optional().describe("m, laterally unbraced length of the compression flange; omit if continuously restrained"), momentFactor: z.number().positive().optional().describe("c1 (IS 800 Annex E) or Cb (AISC) for the moment diagram, default 1.0")}),
    run: (inp0) => {
      const { si: inp, note, us } = fromUS(inp0, { span: "ft", factoredUDL: "klf", factoredPointLoad: "kip", serviceUDL: "klf", servicePointLoad: "kip", factoredMoment: "kipft", fy: "ksi", unbracedLength: "ft" });
      const r = designSteelBeam(inp);
      const cols = us ? ["Section", "Class", "Weight lb/ft", "φMn kip-ft", "Bending util.", "φVn kip", "Shear util.", "Deflection in", "Limit in", "OK"] : ["Section", "Class", "Mass kg/m", "Md kN·m", "Bending util.", "Vd kN", "Shear util.", "Deflection mm", "Limit mm", "OK"];
      const rows = r.candidates.map((c) => us
        ? [c.section, c.sectionClass, (c.mass * 0.67197).toFixed(1), (c.momentCapacity / 1.355818).toFixed(1), c.utilization.toFixed(2), (c.shearCapacity / 4.448222).toFixed(1), c.shearUtilization.toFixed(2), c.deflection !== undefined ? (c.deflection / 25.4).toFixed(2) : "-", (c.deflectionLimit / 25.4).toFixed(2), c.ok ? "✓" : "✗"]
        : [c.section, c.sectionClass, c.mass.toFixed(1), c.momentCapacity.toFixed(1), c.utilization.toFixed(2), c.shearCapacity.toFixed(0), c.shearUtilization.toFixed(2), c.deflection?.toFixed(1) ?? "-", c.deflectionLimit.toFixed(1), c.ok ? "✓" : "✗"]);
      const rec = r.recommended, one = r.candidates[0];
      const defl = (c: typeof one) => (c.deflection !== undefined ? `, deflection ${us ? `${(c.deflection / 25.4).toFixed(2)} in ≤ ${(c.deflectionLimit / 25.4).toFixed(2)} in` : `${c.deflection.toFixed(1)} mm ≤ ${c.deflectionLimit.toFixed(1)} mm`}` : "");
      const summary = rec ? `Use ${rec.section} (bending ${(rec.utilization * 100).toFixed(0)}%, shear ${(rec.shearUtilization * 100).toFixed(0)}%${defl(rec)})` : inp.section && one ? `${one.section}: ${one.ok ? "OK" : `FAILS: bending util ${(one.utilization * 100).toFixed(0)}%, shear util ${(one.shearUtilization * 100).toFixed(0)}%${defl(one)}`}` : "No section in the table works. Increase depth or use a built-up section.";
      return { result: r, display: { kind: "table", title: `Steel beam candidates (${r.support}, Mu = ${us ? kipft(r.Mu) : `${r.Mu.toFixed(1)} kN·m`}, Vu = ${us ? `${(r.Vu / 4.448222).toFixed(1)} kip` : `${r.Vu.toFixed(1)} kN`})${note ? ` · ${note}` : ""}`, columns: cols, rows }, summary };
    },
  }),
  def({
    name: "bearing_capacity",
    category: "geotech",
    description: "Ultimate and safe bearing capacity of a shallow footing (strip/square/circular/rectangular), Terzaghi (default) or IS 6403 method, general or local shear, with water table and (IS 6403) load inclination. FS default 3 (BNBC 2020 allows 2–3). Units kPa, degrees, kN/m³, m. Bearing capacity alone does not limit settlement: also run the settlement tool.",
    schema: z.object({
      units: UNITS_FIELD,
      cohesion: z.number().nonnegative().describe("kPa"), frictionAngle: z.number().min(0).max(50).describe("degrees"),
      unitWeight: z.number().positive().describe("kN/m³ above the water table"), saturatedUnitWeight: z.number().positive().optional().describe("kN/m³ below the water table"),
      depth: z.number().nonnegative().describe("founding depth m"), width: z.number().positive().describe("m"), length: z.number().optional(),
      shape: z.enum(["strip", "square", "circular", "rectangular"]).optional(), waterTableDepth: z.number().optional().describe("m below ground"),
      factorOfSafety: z.number().optional(), method: z.enum(["terzaghi", "is6403"]).optional(), shearMode: z.enum(["general", "local"]).optional().describe("local for loose sand / soft clay"),
      loadInclination: z.number().optional().describe("degrees from vertical (IS 6403)"),
    }),
    run: (inp0) => {
      const { si: inp, note, us } = fromUS(inp0, { cohesion: "psf", unitWeight: "pcf", saturatedUnitWeight: "pcf", depth: "ft", width: "ft", length: "ft", waterTableDepth: "ft" });
      const r = bearingCapacity(inp);
      const p = (kPa: number) => (us ? `${(kPa / 47.8803).toFixed(2)} ksf (${kPa.toFixed(0)} kPa)` : `${kPa.toFixed(0)} kPa`);
      return { result: r, display: { kind: "steps", title: `${r.method} bearing capacity`, steps: [...(note ? [note] : []), ...r.steps, ...r.notes] }, summary: `${r.method}: net ultimate ${p(r.netUltimate)}; net safe ${p(r.netSafe)}, gross safe ${p(r.safe)} (FS ${r.factorOfSafety})` };
    },
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
    schema: z.object({ units: UNITS_FIELD, frictionAngle: z.number(), height: z.number().positive().describe("m (US: ft)"), unitWeight: z.number().positive().describe("kN/m³ above the water table"), saturatedUnitWeight: z.number().positive().optional(), surcharge: z.number().default(0).describe("kPa"), cohesion: z.number().default(0).describe("kPa"), waterTableDepth: z.number().optional().describe("m below the top of the wall") }),
    run: (inp0) => {
      const { si: inp, note, us } = fromUS(inp0, { height: "ft", unitWeight: "pcf", saturatedUnitWeight: "pcf", surcharge: "psf", cohesion: "psf", waterTableDepth: "ft" });
      const r = earthPressure(inp.frictionAngle, inp.height, inp.unitWeight, inp.surcharge, inp.cohesion, { saturatedUnitWeight: inp.saturatedUnitWeight, waterTableDepth: inp.waterTableDepth });
      const F = (kNm: number) => (us ? `${(kNm / 14.5939).toFixed(2)} kip/ft (${kNm.toFixed(1)} kN/m)` : `${kNm.toFixed(1)} kN/m`);
      const L = (m: number) => (us ? `${(m / 0.3048).toFixed(2)} ft` : `${m.toFixed(2)} m`);
      return { result: { ...r, conversion: note ?? undefined }, summary: `Ka = ${r.Ka.toFixed(3)}; active thrust Pa = ${F(r.activeForce)} acting ${L(r.activeArm)} above the base${r.tensionCrackDepth ? `; tension crack ${L(r.tensionCrackDepth)}` : ""}` };
    },
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
    name: "cost_estimate",
    category: "management",
    description: "Cost estimate / BOQ abstract: amount = quantity × rate per item, subtotals by category, then overhead, profit, contingency, VAT and other tax. Returns a downloadable Excel workbook with live formulas. Rates must come from the user, their uploaded rate schedule or BOQ (e.g. PWD/LGED schedule of rates); never invent rates. Leave rate out for items whose rate is unknown and ask the user for it.",
    schema: z.object({
      project: z.string().optional(),
      currency: z.enum(["BDT", "USD"]).default("BDT"),
      items: z.array(z.object({
        code: z.string().optional().describe("item code from the rate schedule, if any"),
        description: z.string(), unit: z.string().describe("e.g. m3, cft, m2, sft, kg, ton, nos, rm, LS"), quantity: z.number(),
        rate: z.number().optional().describe("per unit, from the user or the uploaded schedule of rates; omit if unknown"),
        category: z.string().optional().describe("e.g. Earthwork, Concrete, Reinforcement, Masonry, Finishes, Electrical, Plumbing"),
      })).min(1).max(2000),
      overheadPercent: z.number().min(0).max(100).optional(), profitPercent: z.number().min(0).max(100).optional(), contingencyPercent: z.number().min(0).max(100).optional(),
      vatPercent: z.number().min(0).max(100).optional().describe("applied on the total after overhead, profit and contingency"),
      otherTaxPercent: z.number().min(0).max(100).optional().describe("e.g. AIT or sales tax, same base as VAT"),
      rateSource: z.string().optional().describe("where the rates come from, e.g. 'PWD Schedule of Rates 2022' or 'contractor quotation'"),
    }),
    run: (inp) => {
      const r = costEstimate(inp);
      const f = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const extra: [string, number][] = [["Overhead", r.overhead], ["Profit", r.profit], ["Contingency", r.contingency], ["VAT", r.vat], ["Other tax", r.otherTax]];
      const shown = r.items.slice(0, 300);
      return {
        result: { project: r.project, currency: r.currency, items: r.items.length, subtotal: r.subtotal, overhead: r.overhead, profit: r.profit, contingency: r.contingency, totalBeforeTax: r.beforeTax, vat: r.vat, otherTax: r.otherTax, total: r.total, byCategory: r.byCategory, missingRates: r.missingRates, rateSource: r.rateSource },
        display: { kind: "table", title: `${r.project} (${r.currency})`, columns: ["No.", "Description", "Unit", "Qty", "Rate", "Amount", "Category"], rows: [...shown.map((it) => [it.no, it.description, it.unit, it.quantity, it.rate ?? "rate?", it.amount === null ? "-" : f(it.amount), it.category]), ...(r.items.length > shown.length ? [["", `…${r.items.length - shown.length} more items in the Excel file`, "", "", "", "", ""]] : []), ["", "Subtotal (direct cost)", "", "", "", f(r.subtotal), ""], ...extra.filter(([, v]) => v).map(([k, v]) => ["", k, "", "", "", f(v), ""]), ["", "GRAND TOTAL", "", "", "", f(r.total), ""]] },
        workbook: estimateWorkbook(inp),
        summary: `${r.project}: total ${r.currency} ${f(r.total)} (direct cost ${f(r.subtotal)}${r.total !== r.subtotal ? ` + markups and taxes ${f(r.total - r.subtotal)}` : ""}).${r.missingRates.length ? ` ${r.missingRates.length} item(s) have no rate: ${r.missingRates.slice(0, 5).join("; ")}.` : ""}`,
      };
    },
  }),
  def({
    name: "project_schedule",
    category: "management",
    description: "Construction schedule by the critical path method: early/late start and finish, total and free float, critical path, calendar dates (Bangladesh or US weekends, holidays) and an Excel workbook with live formulas and a Gantt chart. Durations are working days from the user or their documents; do not invent them without saying they are assumptions for the user to confirm.",
    schema: z.object({
      project: z.string().optional(),
      activities: z.array(z.object({
        id: z.coerce.string().describe("short id, e.g. A, B, 1.2"), name: z.string(), duration: z.number().min(0).describe("working days; 0 = milestone"),
        predecessors: z.array(z.coerce.string()).optional().describe('ids of preceding activities: "A" finish-to-start, "A+2" with a 2-day lag, "A SS", "A SS+3", "A FF", "A SF"'),
        resource: z.string().optional(), cost: z.number().optional().describe("activity cost, if known"),
      })).min(1).max(1000),
      startDate: z.string().optional().describe("YYYY-MM-DD; gives calendar dates"),
      weekend: z.enum(["fri", "fri_sat", "sat_sun", "none"]).default("fri").describe("weekly days off: fri = Bangladesh private sector, fri_sat = Bangladesh government, sat_sun = USA, none = 7-day week"),
      holidays: z.array(z.string()).optional().describe("YYYY-MM-DD non-working days"),
    }),
    run: (inp) => {
      const s = projectSchedule(inp);
      const shown = s.rows.slice(0, 300);
      return {
        result: { project: s.project, durationWorkingDays: s.duration, startDate: s.startDate, finishDate: s.finishDate, criticalPath: s.critical, totalCost: s.totalCost, activities: s.rows.map((r) => ({ id: r.id, ES: r.ES, EF: r.EF, LS: r.LS, LF: r.LF, totalFloat: r.totalFloat, freeFloat: r.freeFloat, start: r.start, finish: r.finish })) },
        display: { kind: "table", title: `${s.project}: ${s.duration} working days${s.finishDate ? ` (${s.startDate} to ${s.finishDate})` : ""}`, columns: ["ID", "Activity", "Days", "Predecessors", "ES", "EF", "LS", "LF", "Total float", "Free float", "Critical", ...(s.startDate ? ["Start", "Finish"] : [])], rows: shown.map((r) => [r.id, r.name, r.duration, r.predecessors.join(", ") || "-", r.ES, r.EF, r.LS, r.LF, r.totalFloat, r.freeFloat, r.critical ? "YES" : "", ...(s.startDate ? [r.start!, r.finish!] : [])]) },
        workbook: scheduleWorkbook(inp),
        summary: `Project duration ${s.duration} working days${s.finishDate ? ` (${s.startDate} to ${s.finishDate})` : ""}. Critical path: ${s.critical.join(" → ")}.`,
      };
    },
  }),
  def({
    name: "stormwater_runoff",
    category: "water",
    description: "Peak stormwater runoff by the rational method (Q = CiA/360 SI, Q = CiA US) with composite C, storm frequency factor, and optional Kirpich time of concentration. For site drainage, subdivisions, roads and roofs. Rainfall intensity must come from the local IDF curve (USA: NOAA Atlas 14) or the user; never invent it.",
    schema: z.object({
      units: z.enum(["SI", "US"]).default("SI").describe("SI: ha, mm/h, m³/s; US: acres, in/h, cfs"),
      areas: z.array(z.object({ label: z.string().optional(), area: z.number().positive().describe("ha or acres"), C: z.number().min(0.05).max(1).describe("runoff coefficient, e.g. roofs 0.95, asphalt 0.9, lawns 0.2") })).min(1),
      intensity: z.number().positive().describe("rainfall intensity for duration = tc, mm/h or in/h"),
      returnPeriod: z.number().int().positive().default(10).describe("design storm, years (25/50/100-yr raise C by 1.1/1.2/1.25)"),
      flowLength: z.number().positive().optional().describe("longest flow path, m or ft (for Kirpich tc)"), slope: z.number().positive().optional().describe("average slope of the flow path, m/m"),
    }),
    run: (inp) => {
      const r = rationalMethod(inp);
      const tc = inp.flowLength && inp.slope ? kirpich(inp.flowLength, inp.slope, inp.units) : null;
      return { result: { ...r, tcMinutes: tc?.tc }, display: { kind: "steps", title: `Rational method, ${inp.returnPeriod}-year storm`, steps: [...(tc ? [tc.step] : []), ...r.steps, ...r.notes] }, summary: `Peak runoff Q = ${r.Q.toFixed(inp.units === "US" ? 2 : 3)} ${r.unitsQ} (C = ${r.Ceff.toFixed(2)}, i = ${inp.intensity} ${r.unitsI}, A = ${r.area} ${r.unitsA})${tc ? `; Kirpich tc = ${tc.tc.toFixed(1)} min` : ""}` };
    },
  }),
  def({
    name: "pipe_channel_flow",
    category: "water",
    description: "Manning's equation for drains, sewers, culverts and channels: size the smallest standard pipe for a flow (storm or sanitary, with self-cleansing velocity check), or find the capacity / normal depth of a circular pipe, rectangular or trapezoidal channel. SI (m, m³/s) or US (ft, cfs).",
    schema: z.object({
      mode: z.enum(["size_pipe", "capacity", "normal_depth"]).default("size_pipe"),
      units: z.enum(["SI", "US"]).default("SI"),
      Q: z.number().positive().optional().describe("design flow, m³/s or cfs (size_pipe, normal_depth)"),
      slope: z.number().positive().describe("bed / pipe slope, m/m (0.005 = 0.5%)"),
      n: z.number().positive().default(0.013).describe("Manning's n: concrete pipe 0.013, PVC 0.010, earth channel 0.025–0.030"),
      purpose: z.enum(["storm", "sanitary"]).default("storm"),
      shape: z.enum(["circular", "rectangular", "trapezoidal"]).default("circular").describe("capacity / normal_depth"),
      diameter: z.number().positive().optional().describe("pipe diameter, mm or in"), width: z.number().positive().optional().describe("rectangular or trapezoid bottom width, m or ft"),
      sideSlope: z.number().min(0).optional().describe("trapezoid side slope H:1V"), depth: z.number().positive().optional().describe("flow depth for capacity, m or ft (default: full pipe)"),
    }),
    run: (inp) => {
      const us = inp.units === "US";
      if (inp.mode === "size_pipe") {
        if (!inp.Q) throw new Error("Give the design flow Q");
        const r = sizePipe({ Q: inp.Q, slope: inp.slope, n: inp.n, units: inp.units, purpose: inp.purpose });
        return { result: r, display: { kind: "steps", title: `Pipe size for ${inp.Q} ${us ? "cfs" : "m³/s"} at ${(inp.slope * 100).toFixed(2)}%`, steps: r.steps, checks: r.checks }, summary: `Use Ø${r.diameter} ${r.unit} (n = ${r.n}): full capacity ${r.fullCapacity.toFixed(3)} ${us ? "cfs" : "m³/s"}, flow depth ${r.depth.toFixed(0)} ${r.unit} (${(r.depthRatio * 100).toFixed(0)}% full), velocity ${r.velocity.toFixed(2)} ${us ? "ft/s" : "m/s"}${r.checks.every((c) => c.ok) ? "" : "; velocity below the self-cleansing minimum"}` };
      }
      const len = (v: number) => (inp.shape === "circular" ? (us ? v / 12 : v / 1000) : v);
      const sec: Section = inp.shape === "circular" ? { shape: "circular", diameter: len(inp.diameter ?? NaN) } : inp.shape === "rectangular" ? { shape: "rectangular", width: inp.width ?? NaN } : { shape: "trapezoidal", bottomWidth: inp.width ?? NaN, sideSlope: inp.sideSlope ?? 0 };
      if (Object.values(sec).some((v) => typeof v === "number" && !(v >= 0))) throw new Error(inp.shape === "circular" ? "Give the pipe diameter" : "Give the channel width (and side slope for a trapezoid)");
      const [L, q, v] = us ? ["ft", "cfs", "ft/s"] : ["m", "m³/s", "m/s"];
      if (inp.mode === "capacity") {
        const y = inp.depth ?? (sec.shape === "circular" ? sec.diameter : NaN);
        if (!(y > 0)) throw new Error("Give the flow depth");
        const r = manningQ(sec, y, inp.n, inp.slope, inp.units);
        return { result: { ...r, depth: y }, display: { kind: "steps", title: "Manning capacity", steps: [`A = ${r.A.toFixed(4)} ${L}², P = ${r.P.toFixed(3)} ${L}, R = A/P = ${r.R.toFixed(4)} ${L}`, `V = (${us ? "1.486" : "1"}/${inp.n}) × R^(2/3) × S^(1/2) = ${r.V.toFixed(3)} ${v}`, `Q = V × A = ${r.Q.toFixed(3)} ${q}`] }, summary: `Q = ${r.Q.toFixed(3)} ${q}, V = ${r.V.toFixed(2)} ${v} at depth ${y} ${L}` };
      }
      if (!inp.Q) throw new Error("Give the flow Q");
      const y = normalDepth(sec, inp.Q, inp.n, inp.slope, inp.units);
      if (y === null) throw new Error("The section cannot carry this flow at this slope (it would surcharge); use a larger section");
      const r = manningQ(sec, y, inp.n, inp.slope, inp.units);
      return { result: { ...r, depth: y }, display: { kind: "steps", title: "Normal depth (Manning)", steps: [`Depth found by iteration: y = ${y.toFixed(3)} ${L}`, `A = ${r.A.toFixed(4)} ${L}², R = ${r.R.toFixed(4)} ${L}, V = ${r.V.toFixed(3)} ${v}, Q = ${r.Q.toFixed(3)} ${q}`] }, summary: `Normal depth ${y.toFixed(3)} ${L}, velocity ${r.V.toFixed(2)} ${v}` };
    },
  }),
  def({
    name: "subdivision_layout",
    category: "site",
    description: "Subdivision lot layout and yield for a tract of any shape: rows of lots parallel to the existing road, new internal streets with an access street, open space, lot schedule (Excel), areas and shares (lots, streets, open space), density (lots per acre/hectare, katha per lot), buildable envelope per lot and a DXF site plan. Zoning values (lot size, setbacks, street width) come from the user or the local ordinance; USA adds IFC fire-access checks.",
    schema: z.object({
      tract: PLOT_SCHEMA.describe("the land to subdivide; edge 0 (or roadEdges) is the existing road"),
      units: z.enum(["m", "ft"]).default("m").describe("units of the lot, street and setback dimensions"),
      lotWidth: z.number().positive().describe("minimum lot frontage"), lotDepth: z.number().positive(),
      minLotArea: z.number().positive().optional().describe("m² or sq ft"),
      streetWidth: z.number().positive().describe("right-of-way width of new streets (e.g. 6–9 m in Bangladesh projects, 50 ft typical US local street)"),
      pavementWidth: z.number().positive().optional().describe("paved width inside the ROW"),
      accessStreet: z.enum(["left", "right", "none"]).default("left").describe("street from the existing road to the internal streets; none = streets run through to side roads"),
      openSpacePercent: z.number().min(0).max(60).optional(),
      setbacks: z.object({ front: z.number().min(0), rear: z.number().min(0), side: z.number().min(0) }).optional(),
      maxCoveragePercent: z.number().min(1).max(100).optional(), maxBlockLength: z.number().positive().optional(),
      country: z.enum(["US", "BD", "other"]).default("BD"),
      personsPerLot: z.number().positive().optional().describe("people per plot (flats per plot × household size), for the Bangladesh 350 persons/acre density check"),
      commercialPercent: z.number().min(0).max(30).optional().describe("land for shops along the existing road; Bangladesh rules: at least 1.7% (default for BD)"),
    }),
    run: (inp) => {
      const r = subdivide(inp);
      const ft = inp.units === "ft";
      const k = ft ? 1 / 0.3048 : 1000; // drawing units: ft or mm
      const u = ft ? "ft" : "m", ua = ft ? "sq ft" : "m²";
      const A = (m2: number) => (ft ? m2 / 0.09290304 : m2);
      const P = (x: number, y: number) => [x * k, y * k] as [number, number];
      const rect = (x: number, y: number, w: number, h: number) => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
      const span = Math.max(...r.tract.points.map((q) => Math.max(q[0], q[1]))) * k;
      const th = span / 90;
      const E: DrawingEntity[] = [{ type: "polyline", points: r.tract.points.map(([x, y]) => P(x, y)), closed: true, layer: "CENTER" }];
      for (const st of r.streets) {
        const pts = st.vertical ? rect(st.x, st.y, st.width, st.length) : rect(st.x, st.y, st.length, st.width);
        E.push({ type: "hatch", points: pts, pattern: "earth", layer: "HATCH" }, { type: "polyline", points: pts, closed: true, layer: "DIM" });
        const cx = st.vertical ? st.x + st.width / 2 : st.x + st.length / 2, cy = st.vertical ? st.y + st.length / 2 : st.y + st.width / 2;
        E.push({ type: "text", x: cx * k, y: cy * k, text: `${st.name.toUpperCase()} (${(st.width * (ft ? 1 / 0.3048 : 1)).toFixed(ft ? 0 : 1)} ${u} ROW)`, height: th, rotation: st.vertical ? 90 : 0, align: "center", layer: "TEXT" });
      }
      for (const l of r.lots) {
        E.push({ type: "polyline", points: rect(l.x, l.y, l.width, l.depth), closed: true, layer: "OUTLINE" });
        E.push({ type: "text", x: (l.x + l.width / 2) * k, y: (l.y + l.depth / 2 + th / k * 0.6) * k, text: l.openSpace ? "OPEN SPACE" : l.commercial ? `COMMERCIAL ${l.no}` : `LOT ${l.no}`, height: th, align: "center", layer: "TEXT" });
        if (!l.openSpace && !l.commercial) E.push({ type: "text", x: (l.x + l.width / 2) * k, y: (l.y + l.depth / 2 - th / k * 0.9) * k, text: `${A(l.area).toFixed(0)} ${ua}`, height: th * 0.8, align: "center", layer: "TEXT" });
      }
      const W0 = Math.max(...r.tract.points.map((q) => q[0])) * k;
      E.push({ type: "text", x: W0 / 2, y: -th * 2.5, text: "EXISTING ROAD", height: th * 1.3, align: "center", layer: "TEXT" });
      const drawing: DrawingModel = { title: `Subdivision: ${r.lotCount} lots`, units: ft ? "ft" : "mm", layers: DEFAULT_LAYERS, entities: E, notes: r.notes };
      const katha = (m2: number) => (m2 / 66.8901).toFixed(2);
      const schedule = r.lots.filter((l) => !l.openSpace && !l.commercial).map((l) => [l.no, l.row, l.frontsOn, +(l.width * (ft ? 1 / 0.3048 : 1)).toFixed(2), +(l.depth * (ft ? 1 / 0.3048 : 1)).toFixed(2), +A(l.area).toFixed(1), ...(inp.country === "BD" ? [+katha(l.area)] : []), ...(l.buildable ? [+A(l.buildable.area).toFixed(1)] : [])]);
      const cols = ["Lot", "Row", "Fronts on", `Width ${u}`, `Depth ${u}`, `Area ${ua}`, ...(inp.country === "BD" ? ["Katha"] : []), ...(inp.setbacks ? [`Buildable ${ua}`] : [])];
      const pct = (x: number) => `${x.toFixed(1)}%`;
      const summaryRows: CellSpec[][] = [["Tract area", +A(r.tract.area).toFixed(0), ua], ["Lots", r.lotCount, ""], ["Average lot", +A(r.averageLot).toFixed(0), ua], ["Lots (share)", +r.shares.lots.toFixed(1), "%"], ["Streets (share)", +r.shares.streets.toFixed(1), "%"], ["Open space (share)", +r.shares.openSpace.toFixed(1), "%"], ["Commercial (share)", +r.shares.commercial.toFixed(1), "%"], ["Remnant (share)", +r.shares.remnant.toFixed(1), "%"], ["Density", +(ft ? r.density.perAcre : r.density.perHectare).toFixed(2), ft ? "lots/acre" : "lots/ha"], ["New street length", +(r.streetLength * (ft ? 1 / 0.3048 : 1)).toFixed(0), u]];
      const failing = r.checks.filter((c) => !c.ok);
      return {
        result: { lotCount: r.lotCount, rows: r.rows, internalStreets: r.internalStreets, averageLot: r.averageLot, tractArea: r.tract.area, shares: r.shares, density: r.density, streetLength: r.streetLength, openSpaceArea: r.openSpaceArea, checks: r.checks, notes: r.notes, units: "m and m² (converted in the summary)" },
        display: { kind: "drawing", drawing, svg: toSvg(drawing) },
        workbook: { title: "Subdivision lot schedule", sheets: [{ name: "Lots", title: `Lot schedule: ${r.lotCount} lots`, columns: cols.map((h) => ({ header: h, width: h === "Fronts on" ? 16 : 12 })), rows: schedule }, { name: "Summary", columns: [{ header: "Item", width: 22 }, { header: "Value", width: 14 }, { header: "Unit", width: 12 }], rows: summaryRows, notes: [...r.checks.map((c) => `${c.ok ? "OK" : "FAILS"}: ${c.name}: ${c.detail}`), ...r.notes] }] },
        summary: `${r.lotCount} lots (average ${A(r.averageLot).toFixed(0)} ${ua}${inp.country === "BD" ? `, ${katha(r.averageLot)} katha` : ""}) in ${r.rows} rows with ${r.internalStreets} new street(s); lots ${pct(r.shares.lots)}, streets ${pct(r.shares.streets)}, open space ${pct(r.shares.openSpace)}${r.shares.commercial ? `, commercial ${pct(r.shares.commercial)}` : ""}, remnant ${pct(r.shares.remnant)}; ${ft ? `${r.density.perAcre.toFixed(2)} lots/acre` : `${r.density.perHectare.toFixed(1)} lots/ha`}.${failing.length ? ` Check: ${failing.map((c) => c.name).join("; ")}.` : ""}`,
      };
    },
  }),
  def({
    name: "landscape_quantities",
    category: "site",
    description: "Landscape quantities: plants for a bed at square or triangular spacing, plants/trees along a row, and bulk materials (topsoil, mulch, gravel, compost) as volume and bags; turf/sod area with waste. SI (m, m², mm, litre bags) or US (ft, sq ft, in, cu ft bags).",
    schema: z.object({
      units: z.enum(["SI", "US"]).default("SI"),
      bedArea: z.number().positive().optional().describe("planting area m² or sq ft"), spacing: z.number().positive().optional().describe("plant spacing m or ft"), pattern: z.enum(["triangular", "square"]).default("triangular"),
      rowLength: z.number().positive().optional().describe("hedge / street-tree row length m or ft"), rowSpacing: z.number().positive().optional().describe("spacing along the row m or ft"),
      materialArea: z.number().positive().optional().describe("area to cover m² or sq ft"), materialDepth: z.number().positive().optional().describe("depth mm or in"), material: z.string().default("mulch"), bagSize: z.number().positive().optional().describe("bag size, litres or cu ft"), allowancePercent: z.number().min(0).max(50).default(10).describe("settlement / compaction allowance"),
      turfArea: z.number().positive().optional().describe("sod / turf area m² or sq ft"), turfWastePercent: z.number().min(0).max(30).default(5),
    }),
    run: (inp) => {
      const us = inp.units === "US", ua = us ? "sq ft" : "m²", ul = us ? "ft" : "m";
      const rows: (string | number)[][] = [];
      const result: Record<string, unknown> = {};
      if (inp.bedArea && inp.spacing) { const r = plantsForArea(inp.bedArea, inp.spacing, inp.pattern); result.bed = r; rows.push(["Plants in bed", `${r.plants} (${inp.bedArea} ${ua} at ${inp.spacing} ${ul} ${inp.pattern}; ${r.areaPerPlant.toFixed(3)} ${ua} per plant)`]); }
      if (inp.rowLength && inp.rowSpacing) { const n = plantsForRow(inp.rowLength, inp.rowSpacing); result.row = n; rows.push(["Plants / trees in row", `${n} (${inp.rowLength} ${ul} at ${inp.rowSpacing} ${ul}, both ends)`]); }
      if (inp.materialArea && inp.materialDepth) { const r = bulkMaterial(inp.materialArea, inp.materialDepth, inp.units, inp.bagSize, inp.allowancePercent); result.material = r; rows.push([inp.material, `${r.volume.toFixed(2)} ${r.unit}${us ? ` (${r.cubicFeet?.toFixed(1)} cu ft)` : ""} incl. ${inp.allowancePercent}% allowance; ${r.bags} bags of ${r.bagSize} ${r.bagUnit}`]); }
      if (inp.turfArea) { const a = inp.turfArea * (1 + inp.turfWastePercent / 100); result.turf = a; rows.push(["Sod / turf", `${a.toFixed(1)} ${ua} (${inp.turfWastePercent}% waste)`]); }
      if (!rows.length) throw new Error("Give a bed area and spacing, a row length and spacing, a material area and depth, or a turf area");
      return { result, display: { kind: "table", title: "Landscape quantities", columns: ["Item", "Quantity"], rows }, summary: rows.map((r) => `${r[0]}: ${r[1]}`).join("; ") };
    },
  }),
  def({
    name: "irrigation_water_budget",
    category: "site",
    description: "Landscape water budget by the California Model Water Efficient Landscape Ordinance method (widely used in the USA): maximum applied water allowance (MAWA, ETAF 0.55 residential / 0.45 non-residential) and estimated use per hydrozone from plant factor and irrigation efficiency (0.75 overhead, 0.81 drip). ETo (annual reference evapotranspiration) must come from local data (CIMIS / Appendix A in California, FAO or local met data elsewhere).",
    schema: z.object({
      units: z.enum(["US", "SI"]).default("US").describe("US: ETo in/yr, areas sq ft, gallons; SI: ETo mm/yr, areas m², litres"),
      eto: z.number().positive().describe("annual reference evapotranspiration"),
      use: z.enum(["residential", "non_residential"]).default("residential"),
      zones: z.array(z.object({ name: z.string().optional(), area: z.number().positive(), plantFactor: z.number().min(0).max(1).describe("very low < 0.1, low 0.1–0.3, moderate 0.4–0.6, high 0.7–1.0"), irrigation: z.enum(["overhead", "drip"]).default("overhead"), efficiency: z.number().min(0.3).max(1).optional(), special: z.boolean().default(false).describe("special landscape area (edibles, recreation, recycled water)") })).min(1),
    }),
    run: (inp) => {
      const r = waterBudget(inp);
      const f = (x: number) => Math.round(x).toLocaleString("en-US");
      return { result: r, display: { kind: "table", title: `Water budget (${r.unit})`, columns: ["Hydrozone", "Area", "Plant factor", "Efficiency", "PF/IE", "Estimated use"], rows: [...r.zones.map((z) => [z.name || "-", z.area, z.plantFactor, z.efficiency, z.etaf.toFixed(2), f(z.use)]), ["Estimated total water use (ETWU)", "", "", "", "", f(r.etwu)], [`MAWA (ETAF ${r.etafLimit})`, "", "", "", "", f(r.mawa)]] }, summary: `ETWU ${f(r.etwu)} vs MAWA ${f(r.mawa)} ${r.unit}: ${r.ok ? "within the allowance" : "EXCEEDS the allowance (use lower plant factors, drip, or less turf)"}` };
    },
  }),
  def({
    name: "sprinkler_run_time",
    category: "site",
    description: "Sprinkler precipitation rate (PR = 96.3·gpm/area in/h, or 60·L/min/area mm/h) from total flow and area or head spacing (square or triangular), and weekly run time for a required water depth with a distribution uniformity.",
    schema: z.object({
      units: z.enum(["US", "SI"]).default("US"), flow: z.number().positive().describe("total flow on the area: gpm or L/min (full-circle equivalent per head for spacing)"),
      area: z.number().positive().optional().describe("sq ft or m²"), spacing: z.number().positive().optional().describe("head spacing ft or m"), rowSpacing: z.number().positive().optional(), pattern: z.enum(["square", "triangular"]).default("square"),
      depthPerWeek: z.number().positive().describe("water needed per week, in or mm"), distributionUniformity: z.number().min(0.3).max(1).default(0.75),
    }),
    run: (inp) => { const r = sprinkler(inp); return { result: r, summary: `Precipitation rate ${r.precipitationRate.toFixed(2)} ${r.unit}; run ${r.minutesPerWeek.toFixed(0)} minutes per week (DU ${r.distributionUniformity}) for ${inp.depthPerWeek} ${inp.units === "SI" ? "mm" : "in"}` }; },
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
    description: "Building planner for architects/engineers: plot of any real shape (rectangular, square, trapezoid, four sides + diagonal, L-shape, triangle, corner cut, flag lot, custom corners or survey traverse; m or ft), road/front direction, setbacks, building type (single_family, duplex, apartment, shop_house, commercial, office), storeys, bedrooms/bathrooms, garage, shops, windows per room → automatic room programme, one floor plan per storey (DXF-exportable), NBC minimum-size checks, footprint, coverage and FAR. Units m.",
    schema: z.object({
      plot: PLOT_SCHEMA,
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
      standard: z.enum(["BNBC2020", "NBC2016", "IRC2021"]).optional().describe("room-size rules: BNBC 2020 (default, Bangladesh), NBC 2016 (India) or IRC2021 (USA houses: no Dhaka zoning defaults; give zoning setbacks)"),
    }),
    run: (inp) => {
      const r = planBuilding(inp);
      // One drawing with all floors side by side.
      const entities: DrawingEntity[] = [];
      let offset = 0;
      const pl = r.plot, mm = (v: number) => Math.round(v * 1000);
      const plotW = mm(Math.max(...pl.geometry.points.map((q) => q[0])));
      for (const f of r.floors) {
        const rooms = f.layout.rooms.map((x) => ({ ...x, x: x.x + mm(pl.offset.x), y: x.y + mm(pl.offset.y) }));
        const d = floorPlan({ rooms, wallThickness: inp.wallThickness, title: f.floor.toUpperCase() });
        // Property line (dash-dot), edge lengths, buildable rectangle and the road, drawn around every floor.
        const pts = pl.geometry.points.map(([x, y]) => [mm(x), mm(y)] as [number, number]);
        d.entities.push({ type: "polyline", points: pts, closed: true, layer: "CENTER" });
        for (const e of pl.geometry.edges) {
          const [x1, y1] = e.from, [x2, y2] = e.to, ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          const nx = (y2 - y1) / e.length, ny = -(x2 - x1) / e.length; // outward normal
          d.entities.push({ type: "text", x: mm((x1 + x2) / 2 + nx * 0.6), y: mm((y1 + y2) / 2 + ny * 0.6), text: `${e.length.toFixed(2)} m${e.role === "road" ? " (ROAD)" : ""}`, height: 250, rotation: ang > 90 || ang < -90 ? ang + 180 : ang, align: "center", layer: "TEXT" });
        }
        if (pl.buildableRect) { const b = pl.buildableRect; d.entities.push({ type: "polyline", points: [[mm(b.x), mm(b.y)], [mm(b.x + b.width), mm(b.y)], [mm(b.x + b.width), mm(b.y + b.depth)], [mm(b.x), mm(b.y + b.depth)]], closed: true, layer: "DIM" }); }
        d.entities.push({ type: "text", x: Math.round(plotW / 2), y: -1500, text: "ROAD", height: 350, align: "center", layer: "TEXT" });
        const w = Math.max(plotW, ...rooms.map((x) => x.x + x.width)) + 3000;
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
      wallThickness: z.number().default(230).describe("mm"), corridorWidth: z.number().default(1.2).describe("m; 0 for none"), entrySide: z.enum(["S", "N", "E", "W"]).default("S"), standard: z.enum(["BNBC2020", "NBC2016", "IRC2021"]).optional().describe("room-size rules, default BNBC 2020"),
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

// Calculator families kept in their own files (engine in src/lib/eng, tests in tests/).
TOOLS.push(...ROAD_TOOLS, ...PAVEMENT_TOOLS, ...MIX_TOOLS);
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** Always-available small tools. */
const CORE_TOOLS = ["calculate", "convert_units", "search_code_clauses"];
const TOOL_GROUPS: { keys: RegExp; tools: string[] }[] = [
  { keys: /\b(beam|girder|lintel|joist|purlin|udl|point load|bending|shear|deflect|moment|cantilever|span|capacity|flexural|mn|φmn|phi ?mn)\b|বিম|বীম/i, tools: ["analyze_beam", "design_rc_beam", "rc_beam_capacity", "design_steel_beam", "draw_beam_section", "draw_beam_elevation"] },
  { keys: /\b(column|pillar|post|axial|strut)\b|কলাম/i, tools: ["design_rc_column", "draw_column_section"] },
  { keys: /\b(slab|floor plate|roof slab|deck)\b|স্ল্যাব|ছাদ/i, tools: ["design_one_way_slab"] },
  { keys: /\b(footing|foundation|soil|bearing|sbc|terzaghi|retaining|earth pressure|pile|settle\w*|consolidat\w*|spt|clay|sand)\b|ফাউন্ডেশন|ফুটিং|পাইল|মাটি/i, tools: ["bearing_capacity", "settlement", "earth_pressure", "design_isolated_footing", "draw_footing"] },
  { keys: /\b(steel|ismb|w-?shape|section|rolled)\b/i, tools: ["design_steel_beam", "analyze_beam"] },
  { keys: /\b(quantit|estimat|boq|bill|cement|sand|aggregate|stone chip|khoa|bag|brick|block|masonry|plaster|paint|tile|excavat|earthwork|cut|fill|volume|rebar|rods?\b|steel weight|bar bending|bbs|material)|সিমেন্ট|বালি|খোয়া|পাথর|ইট|রড|ঢালাই|প্লাস্টার/i, tools: ["concrete_materials", "rebar_schedule", "masonry_and_finishes", "earthwork_volume", "cost_estimate"] },
  { keys: /\b(cost|costing|budget|rate|rates|price|tender|abstract|estimate|boq|expense|taka|tk|bdt|usd|dollar)\b|খরচ|বাজেট|দাম|রেট|টাকা|প্রাক্কলন/i, tools: ["cost_estimate"] },
  { keys: /\b(road (design|geometry|alignment|cross[- ]?section|type)|highway\w*|curve\w*|superelevation|super-elevation|camber|sight distance|ssd|isd|osd|stopping distance|chainage|pvi|pvc|pvt|crest|sag|vertical curve|horizontal curve|gradient|widening|carriageway|design speed|alignment|setting out)\b|রাস্তার নকশা|সড়কের নকশা|বাঁক/i, tools: ["horizontal_curve", "curve_radius_superelevation", "sight_distance", "vertical_curve", "road_cross_section"] },
  { keys: /\b(pavement\w*|asphalt|bitumin\w*|carpeting|flexible pavement|rigid pavement|concrete road|esal|msa|cbr|subgrade|sub-?base|base course|aashto|rhd|lged|axle load|traffic load\w*|structural number|parking lot|driveway|road pavement|road thickness)\b|কার্পেটিং|রাস্তার পুরুত্ব/i, tools: ["pavement_flexible_aashto", "pavement_rigid_aashto", "traffic_esal", "pavement_rhd_catalogue"] },
  { keys: /\b(mix design|mix proportion\w*|w\/c|water[- ]cement ratio|trial mix|target strength|aci 211|is 10262|design mix|concrete mix)\b|মিক্স ডিজাইন/i, tools: ["mix_design_aci", "mix_design_is10262", "concrete_materials"] },
  { keys: /\b(subdivi\w*|lot layout|lot yield|lots|layout of plots|plotting|housing project|residential project|land development|site plan|master ?plan|parcel\w*|landscap\w*|planting|plants?|trees?|shrubs?|hedge|lawn|turf|sod|mulch|topsoil|irrigat\w*|sprinkler\w*|drip|garden\w*|park)\b|প্লট ভাগ|আবাসন প্রকল্প|বাগান|গাছ/i, tools: ["subdivision_layout", "landscape_quantities", "irrigation_water_budget", "sprinkler_run_time"] },
  { keys: /\b(drain\w*|storm ?water|runoff|rainfall|rational method|catchment|culvert|sewer\w*|pipe\w*|manning|channel|gutter|detention|flood\w*|hydraul\w*)\b|ড্রেন|নালা|পানি নিষ্কাশন|বৃষ্টি/i, tools: ["stormwater_runoff", "pipe_channel_flow"] },
  { keys: /\b(schedule|scheduling|programme|program|gantt|cpm|pert|critical path|duration|timeline|time plan|work plan|milestone|how long)\b|সময়সূচি|কতদিন|মাস/i, tools: ["project_schedule"] },
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
