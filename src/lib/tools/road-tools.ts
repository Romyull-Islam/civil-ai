/**
 * Road geometric-design tools (transport category). Pure math lives in @/lib/eng/roadgeo.
 * Standard choice: USA → AASHTO Green Book (US units); Bangladesh → RHD for national/regional/feeder roads, LGED for
 * upazila/union/village roads; IRC where the Bangladesh standards are silent or on request.
 */
import { z } from "zod";
import type { ToolDef } from "@/lib/tools";
import { horizontalCurve, radiusSuperelevation, sightDistance, verticalCurve, roadCrossSection, formatDMS, lengthUnit, speedUnit, type Units } from "@/lib/eng/roadgeo";

const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t as unknown as ToolDef;

const units = z.enum(["SI", "US"]).default("SI").describe("SI = km/h and metres; US = mph and feet (AASHTO US customary)");
const standard = z.enum(["AASHTO", "RHD", "LGED", "IRC"]).describe("AASHTO for the USA (and general use); RHD for Bangladesh national/regional/feeder roads; LGED for Bangladesh upazila/union/village roads; IRC (Indian Roads Congress) on request or where RHD/LGED are silent");
const roadType = z.enum(["single_lane", "two_lane", "dual"]).optional().describe("RHD road type: single_lane (3.7 m, Type 6), two_lane (default), dual carriageway (Types 1–2)");
const sightType = z.enum(["SSD", "ISD", "OSD"]).optional().describe("sight distance basis: SSD stopping (default), ISD intermediate, OSD overtaking (RHD/IRC)");
const terrain = z.enum(["plain", "rolling", "hilly"]).optional().describe("terrain (RHD/LGED gradient and superelevation rules)");

const f2 = (x: number | undefined) => (x === undefined ? "-" : x.toFixed(2));
const withNotes = (steps: string[], notes: string[]) => [...steps, ...notes.map((n) => `Note: ${n}`)];

export const ROAD_TOOLS: ToolDef[] = [
  def({
    name: "horizontal_curve",
    category: "transport",
    description: "Simple circular horizontal curve: solves R and Δ from any sufficient pair (R, Δ, T, E, M, LC, L or US degree of curve), then T, L, E, M, LC, PC/PT chainages (PC = PI − T, PT = PC + L) and the setting-out table by deflection angles (Rankine: sub-chords, δ = 1718.87c/R minutes, chords, cumulative deflections). Unit-independent geometry; units only set the chainage format (SI 3+104.41 m, US stations 199+48 ft). Use for the USA and Bangladesh alike.",
    schema: z.object({
      units,
      radius: z.number().positive().optional().describe("R, m (SI) or ft (US)"),
      deflectionAngle: z.number().positive().lt(180).optional().describe("Δ (intersection angle I) in DECIMAL degrees, e.g. 36°30′ = 36.5"),
      tangentLength: z.number().positive().optional().describe("T, m or ft"),
      externalDistance: z.number().positive().optional().describe("E, m or ft"),
      middleOrdinate: z.number().positive().optional().describe("M, m or ft"),
      longChord: z.number().positive().optional().describe("LC, m or ft"),
      curveLength: z.number().positive().optional().describe("arc length L, m or ft"),
      degreeOfCurve: z.number().positive().optional().describe("US only: degree of curve D, arc definition (100-ft arc), R = 5729.58/D"),
      piChainage: z.number().optional().describe("PI running distance: chainage 3+250 → 3250 (m); station 200+00 → 20000 (ft)"),
      chordInterval: z.number().positive().optional().describe("peg / chord interval for setting out, default 20 m (SI) or 100 ft (US)"),
      showTable: z.boolean().optional().describe("true to show the setting-out table (Excel-exportable) instead of the worked steps"),
    }),
    run: (inp) => {
      const r = horizontalCurve(inp);
      const lu = lengthUnit(r.units);
      const summary = `R = ${f2(r.R)} ${lu}, Δ = ${r.delta.toFixed(4)}° (${formatDMS(r.delta)}): T = ${f2(r.T)}, L = ${f2(r.L)}, E = ${f2(r.E)}, M = ${f2(r.M)}, LC = ${f2(r.LC)} ${lu}${r.pi !== undefined ? `; PC ${r.pcLabel}, PT ${r.ptLabel}` : ""}`;
      if (inp.showTable) {
        return {
          result: r,
          display: { kind: "table", title: `Setting out by deflection angles from PC ${r.pcLabel} (R ${f2(r.R)} ${lu}, Δ ${formatDMS(r.delta)})`, columns: ["Point", "Chainage", `Arc (${lu})`, `Chord (${lu})`, "Deflection", "Total deflection", `Chord from PC (${lu})`], rows: [["PC", r.pcLabel, "", "", "", "0°00′00″", ""], ...r.settingOut.map((x) => [x.point, x.label, x.arc.toFixed(3), x.chord.toFixed(3), formatDMS(x.deflection), formatDMS(x.totalDeflection), x.chordFromPC.toFixed(3)])] },
          summary,
        };
      }
      return { result: r, display: { kind: "steps", title: `Horizontal curve R ${f2(r.R)} ${lu}, Δ ${formatDMS(r.delta)}`, steps: withNotes(r.steps, r.notes), checks: r.checks }, summary };
    },
  }),
  def({
    name: "curve_radius_superelevation",
    category: "transport",
    description: "Horizontal curve radius and superelevation by standard. Give designSpeed only → minimum radius; designSpeed and radius → required superelevation (AASHTO Method 5 with runoff/tangent runout; RHD Tables 5.1–5.3 with transition lengths; LGED E = V²/127R or V²/225R ≤ 1/15 with transition; IRC e = V²/225R ≤ 0.07 and f ≤ 0.15 check, allowable speed); radius only → safe/maximum design speed. USA: standard AASHTO with units US. Bangladesh: RHD for national/regional/feeder roads, LGED for upazila/union roads (both metric).",
    schema: z.object({
      units, standard,
      designSpeed: z.number().positive().optional().describe("design speed, km/h (SI) or mph (US)"),
      radius: z.number().positive().optional().describe("curve radius, m or ft"),
      emax: z.number().positive().max(12).optional().describe("maximum superelevation in %: AASHTO default 8 (4–12), IRC 7, LGED 6.67 (1 in 15); RHD max is 7"),
      sideFriction: z.number().positive().max(0.5).optional().describe("side friction factor f to use instead of the standard's value"),
      superelevation: z.number().min(0).max(12).optional().describe("superelevation provided, % (for the safe-speed case)"),
      terrain,
      roadType,
      sightDistanceType: sightType,
      roadClass: z.enum(["upazila", "union", "village"]).optional().describe("LGED road class (Table-6 no-superelevation radius)"),
      laneWidth: z.number().positive().optional().describe("AASHTO runoff: lane width, default 3.6 m or 12 ft"),
      lanesRotated: z.number().min(1).max(3.5).optional().describe("AASHTO runoff: lanes rotated on one side of the axis, default 1"),
      normalCrossSlope: z.number().positive().max(5).optional().describe("AASHTO tangent runout: normal cross slope %, default 2"),
    }),
    run: (inp) => {
      const r = radiusSuperelevation(inp) as ReturnType<typeof radiusSuperelevation> & Record<string, unknown>;
      const u = inp.units as Units;
      const lu = lengthUnit(u), su = speedUnit(u);
      const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : undefined);
      let summary: string;
      if (r.mode === "min_radius") summary = `${inp.standard}: minimum radius ${f2(num("minRadius"))} ${lu} at ${inp.designSpeed} ${su}${num("minRadiusRounded") !== undefined ? ` (AASHTO table value ${num("minRadiusRounded")} ${lu})` : ""}`;
      else if (r.mode === "superelevation") {
        const e = num("superelevationDesign") ?? num("superelevation");
        summary = `${inp.standard}: e = ${e === undefined ? "-" : `${(e * 100).toFixed(1)}%`} for R = ${inp.radius} ${lu} at ${inp.designSpeed} ${su}${r.crown === "NC" ? " (normal crown)" : r.crown === "RC" ? " (remove crown, 2%)" : ""}${num("allowableSpeed") !== undefined ? `; speed must be limited to ${f2(num("allowableSpeed"))} ${su}` : ""}`;
      } else summary = `${inp.standard}: safe speed on R = ${inp.radius} ${lu}: ${num("safeSpeed") !== undefined ? `${f2(num("safeSpeed"))} ${su}` : "below the tabulated range"}${num("designSpeedTabulated") !== undefined ? ` (highest tabulated design speed ${num("designSpeedTabulated")} ${su})` : ""}${num("safeSpeedIrcFormula") !== undefined ? `; IRC formula ${f2(num("safeSpeedIrcFormula"))} ${su}` : ""}`;
      const failing = r.checks.filter((c) => !c.ok);
      if (failing.length) summary += `. CHECK FAILS: ${failing.map((c) => c.name).join("; ")}`;
      return { result: r, display: { kind: "steps", title: `Radius and superelevation (${inp.standard})`, steps: withNotes(r.steps, r.notes), checks: r.checks }, summary };
    },
  }),
  def({
    name: "sight_distance",
    category: "transport",
    description: "Stopping, intermediate and overtaking sight distance with grade. AASHTO: SSD = 0.278Vt + 0.039V²/a (SI) or 1.47Vt + 1.075V²/a (US), grade form V²/(254((a/9.81) ± G)) / V²/(30((a/32.2) ± G)), design value rounded up to 5. RHD: Table 2.3 SSD/ISD/OSD (with an IRC-formula grade check). IRC/LGED: SSD = vt + v²/(2g(f ± n)), ISD = 2·SSD, OSD from the overtaking acceleration. USA → AASHTO (units US); Bangladesh → RHD or LGED.",
    schema: z.object({
      units, standard,
      designSpeed: z.number().positive().describe("km/h (SI) or mph (US)"),
      grade: z.number().min(-15).max(15).optional().describe("longitudinal grade in %, + upgrade, − downgrade"),
      reactionTime: z.number().positive().optional().describe("perception-reaction time s, default 2.5"),
      deceleration: z.number().positive().optional().describe("AASHTO deceleration a, default 3.4 m/s² or 11.2 ft/s²"),
      friction: z.number().positive().max(0.8).optional().describe("IRC longitudinal friction f (default by speed, 0.35–0.40)"),
      roadType,
      acceleration: z.number().positive().optional().describe("IRC OSD: acceleration of the overtaking vehicle, m/s²"),
      overtakenSpeed: z.number().positive().optional().describe("IRC OSD: speed of the overtaken vehicle km/h (default V − 16)"),
    }),
    run: (inp) => {
      const r = sightDistance(inp) as ReturnType<typeof sightDistance> & Record<string, unknown>;
      const lu = lengthUnit(inp.units as Units);
      const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : undefined);
      const parts = [n("ssdDesign") !== undefined ? `SSD ${f2(n("ssd"))} ${lu} (design ${n("ssdDesign")} ${lu})` : `SSD ${f2(n("ssd"))} ${lu}`];
      if (n("isd") !== undefined) parts.push(`ISD ${f2(n("isd"))} ${lu}`);
      if (n("osd") !== undefined) parts.push(`OSD ${f2(n("osd"))} ${lu}`);
      return { result: r, display: { kind: "steps", title: `Sight distance (${inp.standard}, ${inp.designSpeed} ${speedUnit(inp.units as Units)})`, steps: withNotes(r.steps, r.notes), checks: r.checks }, summary: `${inp.standard}: ${parts.join(", ")}${inp.grade ? ` on ${inp.grade}% grade` : ""}` };
    },
  }),
  def({
    name: "vertical_curve",
    category: "transport",
    description: "Crest or sag vertical curve length from grades: by sight distance (chooses S < L or S ≥ L correctly), minimum K (AASHTO tables; RHD Table 6.1 by road type and SSD/ISD/OSD), minimum/appearance length (AASHTO 0.6V m or 3V ft; RHD Table 6.2) and sag comfort; returns the governing length. With a PVI chainage and level: PVC/PVT chainages and levels, high/low point, and levels at stations. AASHTO crest AS²/658 (SI) or AS²/2158 (US); sag headlight AS²/(120 + 3.5S) or AS²/(400 + 3.5S). RHD/IRC use eye 1.2 m, object 0.15 m (SSD) or 1.2 m (ISD/OSD). USA → AASHTO (units US); Bangladesh → RHD (LGED uses IRC formulas).",
    schema: z.object({
      units, standard,
      g1: z.number().min(-30).max(30).describe("approach (back) grade in %, + rising, e.g. +2 or -3.75"),
      g2: z.number().min(-30).max(30).describe("departure (forward) grade in %"),
      designSpeed: z.number().positive().optional().describe("km/h (SI) or mph (US)"),
      sightDistance: z.number().positive().optional().describe("sight distance S to use instead of the standard's value, m or ft"),
      sightDistanceType: sightType,
      roadType,
      K: z.number().positive().optional().describe("design K = L/A to use (checked against the minimum)"),
      length: z.number().positive().optional().describe("proposed curve length to use and check, m or ft"),
      pviChainage: z.number().optional().describe("PVI running distance (chainage 1+250 → 1250 m; station 12+50 → 1250 ft)"),
      pviLevel: z.number().optional().describe("PVI elevation, m or ft"),
      interval: z.number().positive().optional().describe("station interval for levels, default 20 m or 50 ft"),
      terrain,
      showTable: z.boolean().optional().describe("true to show the station levels as a table (Excel-exportable)"),
    }),
    run: (inp) => {
      const r = verticalCurve(inp) as ReturnType<typeof verticalCurve> & Record<string, unknown>;
      const lu = lengthUnit(inp.units as Units);
      const sight = r.sight as { case: string; L: number } | undefined;
      const levels = r.levels as { point: string; label: string; x: number; tangentLevel: number; correction: number; level: number }[] | undefined;
      const tp = r.turningPoint as { chainage: number; level: number } | undefined;
      const summary = `${inp.standard} ${r.type} curve, A = ${(r.A as number).toFixed(2)}%: required L = ${f2(r.requiredLength as number)} ${lu} (${r.governing})${sight ? `; sight-distance length ${f2(sight.L)} ${lu} (${sight.case === "S<L" ? "S < L" : "S ≥ L"})` : ""}; using L = ${f2(r.length as number)} ${lu}, K = ${(r.K as number).toFixed(1)}${r.pvcLabel ? `; PVC ${r.pvcLabel}, PVT ${r.pvtLabel}` : ""}${tp ? `; ${r.type === "crest" ? "high" : "low"} point level ${tp.level.toFixed(3)}` : ""}${r.checks.some((c) => !c.ok) ? `. CHECK FAILS: ${r.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}` : ""}`;
      if (inp.showTable && levels) {
        return { result: r, display: { kind: "table", title: `Vertical curve levels, L = ${f2(r.length as number)} ${lu}`, columns: ["Point", "Chainage", `x from PVC (${lu})`, "Tangent level", "Offset", "Curve level"], rows: levels.map((l) => [l.point, l.label, l.x.toFixed(2), l.tangentLevel.toFixed(3), l.correction.toFixed(3), l.level.toFixed(3)]) }, summary };
      }
      return { result: r, display: { kind: "steps", title: `${r.type === "crest" ? "Crest" : "Sag"} vertical curve (${inp.standard})`, steps: withNotes(r.steps, r.notes), checks: r.checks }, summary };
    },
  }),
  def({
    name: "road_cross_section",
    category: "transport",
    description: "Bangladesh road cross-section by design type: RHD Types 1–6 (national/regional/feeder; Table 2.1: carriageway, paved shoulders, median, NMV lane, verge, crest; typical design speeds, crossfall, max gradient) or LGED Types 4–8 (upazila/union rural roads; Table-4, camber, gradients). Picks the type from design-year traffic (RHD: peak-hour PCU; LGED: commercial vehicles/day) if not given, and gives curve widening for a radius (RHD Table 5.4, LGED Table-7). Metric.",
    schema: z.object({
      standard: z.enum(["RHD", "LGED"]).describe("RHD for national/regional/feeder roads; LGED for upazila/union/village roads"),
      designType: z.number().int().min(1).max(8).optional().describe("RHD 1–6 or LGED 4–8"),
      pcuPeakHour: z.number().positive().optional().describe("design-year peak-hour flow, PCU/h (RHD type selection; LGED Type 4)"),
      commercialVehiclesPerDay: z.number().positive().optional().describe("LGED: projected trucks + buses per day"),
      radius: z.number().positive().optional().describe("horizontal curve radius m, for the extra width on curves"),
      terrain,
    }),
    run: (inp) => {
      const r = roadCrossSection(inp) as ReturnType<typeof roadCrossSection> & Record<string, unknown>;
      const s = r.section as { crest: number; carriageway: number; carriageways: number; lanes: number };
      const w = typeof r.widening === "number" ? r.widening : undefined;
      const summary = `${inp.standard} Type ${r.designType}: carriageway ${s.carriageways > 1 ? `2 × ${s.carriageway}` : s.carriageway} m (${s.lanes} lane${s.lanes > 1 ? "s" : ""}), crest ${s.crest} m${w !== undefined ? `; extra width on R = ${inp.radius} m curve: ${w ? `${w} m` : "nil"}` : ""}`;
      return { result: r, display: { kind: "steps", title: `${inp.standard} Type ${r.designType} cross-section`, steps: withNotes(r.steps, r.notes), checks: r.checks }, summary };
    },
  }),
];
