/**
 * Pavement design tools (AASHTO 1993 flexible and rigid, cumulative ESAL / msa, Bangladesh RHD 2005 catalogue).
 * Engineering math lives in src/lib/eng/pavement.ts; this file only maps zod inputs to the engine and formats output.
 * Types only are imported from "@/lib/tools" to avoid a runtime import cycle with the registry.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput } from "@/lib/tools";
import { designFlexible, designRigid, cumulativeESAL, rhdFlexibleDesign, fmtInt, MM_PER_IN } from "@/lib/eng/pavement";

const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t as unknown as ToolDef;

const units = z.enum(["US", "SI"]).default("US").describe("US: psi, in, pci. SI: MPa, mm, MPa/m (converted at input; the AASHTO equations run in US units and results are given in both)");
const W18 = z.number().positive("W18 must be greater than 0").describe("design-lane 18-kip (80 kN) ESAL over the design period, e.g. 5000000 = 5 msa (use traffic_esal to compute it)");
const reliability = z.number().min(50, "Reliability must be at least 50 %").max(99.99, "Reliability must be at most 99.99 %").describe("reliability R in %, 50–99.99");
const quality = z.enum(["excellent", "good", "fair", "poor", "very_poor"]).optional().describe("drainage quality (AASHTO): water removed within 2 h excellent, 1 day good, 1 week fair, 1 month poor, never very_poor");
const exposure = z.enum(["under_1", "1_to_5", "5_to_25", "over_25"]).optional().describe("% of time the pavement structure is near saturation: under 1 %, 1–5 %, 5–25 %, over 25 %");
const stepsDisplay = (title: string, steps: string[], notes: string[], checks: { name: string; ok: boolean; detail: string }[]): ToolOutput["display"] => ({ kind: "steps", title, steps: [...steps, ...notes.map((n) => `Note: ${n}`)], checks });

const US_BD_GUIDE = "USA: AASHTO 1993 (many state DOTs now use AASHTOWare Pavement ME / MEPDG for major highways; AASHTO 93 remains standard for local, county and parking-lot pavements). Bangladesh: pavement_rhd_catalogue for RHD roads; AASHTO 93 with RHD traffic for strategic National roads; LGED standards for rural roads.";

export const PAVEMENT_TOOLS: ToolDef[] = [
  def({
    name: "pavement_flexible_aashto",
    category: "transport",
    description: `AASHTO 1993 flexible (asphalt) pavement design: required structural number SN from W18, reliability, S0, ΔPSI and subgrade MR (or CBR: MR = 1500·CBR psi, or IRC:37 correlation). Optional: AASHTO layered design (give baseModulus, subbaseModulus → D1, D2, D3 rounded up, with AASHTO minimum thicknesses), or check given layer thicknesses (D1, D2, D3; leave exactly one out to solve it). Layer coefficients default AASHTO 0.44/0.14/0.11 or 'bangladesh' 0.42/0.14/0.11; drainage m from AASHTO Table 2.4. ${US_BD_GUIDE}`,
    schema: z.object({
      units, W18, reliability,
      S0: z.number().optional().describe("overall standard deviation, default 0.45 (typical 0.40–0.50 for flexible)"),
      deltaPSI: z.number().optional().describe("serviceability loss p0 − pt, default 4.2 − 2.5 = 1.7"),
      p0: z.number().optional().describe("initial serviceability, default 4.2"), pt: z.number().optional().describe("terminal serviceability, default 2.5 (2.0 for low-volume roads)"),
      MR: z.number().positive("MR must be greater than 0").optional().describe("subgrade resilient modulus: psi (US) or MPa (SI)"),
      CBR: z.number().positive("CBR must be greater than 0").optional().describe("soaked subgrade CBR %, used if MR is not given"),
      mrCorrelation: z.enum(["aashto", "irc37"]).optional().describe("CBR→MR: aashto 1500·CBR psi (default; valid for CBR ≤ 10) or irc37 (IRC:37-2018)"),
      coefficients: z.enum(["aashto", "bangladesh"]).optional().describe("default layer coefficients: aashto 0.44/0.14/0.11, bangladesh (JICA) 0.42/0.14/0.11 with m = 1.0"),
      a1: z.number().optional().describe("asphalt layer coefficient per in"), a2: z.number().optional().describe("base layer coefficient"), a3: z.number().optional().describe("subbase layer coefficient"),
      m2: z.number().optional().describe("base drainage coefficient"), m3: z.number().optional().describe("subbase drainage coefficient"),
      drainageQuality: quality, saturationExposure: exposure,
      baseModulus: z.number().positive().optional().describe("granular base resilient modulus EBS: psi (US) or MPa (SI) → AASHTO layered design"),
      subbaseModulus: z.number().positive().optional().describe("granular subbase modulus ESB: psi (US) or MPa (SI)"),
      coefficientsFromModulus: z.boolean().optional().describe("derive a2, a3 from the moduli: a2 = 0.249·log10(EBS) − 0.977, a3 = 0.227·log10(ESB) − 0.839"),
      subbase: z.boolean().optional().describe("false for asphalt + base directly on the subgrade (default true)"),
      D1: z.number().nonnegative().optional().describe("asphalt thickness: in (US) or mm (SI), to check"),
      D2: z.number().nonnegative().optional().describe("base thickness: in (US) or mm (SI)"),
      D3: z.number().nonnegative().optional().describe("subbase thickness: in (US) or mm (SI)"),
      roundTo: z.number().positive().optional().describe("rounding step for designed layers: in (US, default 0.5) or mm (SI, default 10)"),
    }),
    run: (inp) => {
      const r = designFlexible(inp);
      const si = r.units === "SI";
      const t = (dIn: number) => (si ? `${(dIn * MM_PER_IN).toFixed(0)} mm` : `${dIn.toFixed(1)} in`);
      const mr = si ? `${r.MR_MPa.toFixed(1)} MPa` : `${fmtInt(r.MR_psi)} psi`;
      const layers = r.layers ? `; layers ${r.layers.map((l) => `${l.layer.toLowerCase()} ${t(l.D_in)}`).join(", ")} give SN ${r.SNprovided!.toFixed(2)} (${r.ok ? "OK" : "NOT OK: " + r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")})` : "";
      return {
        result: r,
        display: stepsDisplay(`AASHTO 1993 flexible pavement (W18 = ${fmtInt(r.W18)})`, r.steps, r.notes, r.checks),
        summary: `AASHTO 1993 flexible: required SN = ${r.SN.toFixed(2)} in (${r.SN_mm.toFixed(0)} mm) for W18 = ${fmtInt(r.W18)}, R = ${r.reliability} %, S0 = ${r.S0}, ΔPSI = ${r.deltaPSI.toFixed(2)}, MR = ${mr}${layers}.`,
      };
    },
  }),
  def({
    name: "pavement_rigid_aashto",
    category: "transport",
    description: `AASHTO 1993 rigid (PCC / concrete) pavement slab thickness D from W18, reliability, S0, ΔPSI, pt, modulus of rupture S'c, Ec, k (or roadbed MR → k = MR/19.4 with no subbase), load transfer J (or pavement type, shoulder and dowels → FHWA Table C-4) and drainage Cd (or AASHTO Table 2.5 quality/exposure). Reports D rounded up to 0.5 in (10 mm SI). ${US_BD_GUIDE}`,
    schema: z.object({
      units, W18, reliability,
      S0: z.number().optional().describe("overall standard deviation, default 0.35 (typical 0.30–0.40 for rigid)"),
      deltaPSI: z.number().optional().describe("serviceability loss p0 − pt, default 4.5 − 2.5 = 2.0"),
      p0: z.number().optional().describe("initial serviceability, default 4.5"), pt: z.number().optional().describe("terminal serviceability, default 2.5"),
      Sc: z.number().positive("S'c must be greater than 0").describe("concrete 28-day flexural strength (modulus of rupture) S'c: psi (US, e.g. 650) or MPa (SI, e.g. 4.5)"),
      Ec: z.number().positive("Ec must be greater than 0").describe("concrete elastic modulus: psi (US, e.g. 4000000) or MPa (SI, e.g. 28000)"),
      k: z.number().positive("k must be greater than 0").optional().describe("effective modulus of subgrade reaction: pci (US) or MPa/m (SI)"),
      MR: z.number().positive().optional().describe("roadbed resilient modulus, psi or MPa: k = MR/19.4 for a slab directly on the subgrade (if k not given)"),
      J: z.number().optional().describe("load transfer coefficient (e.g. 3.2 doweled JPCP with asphalt shoulder, 2.8 with tied PCC shoulder)"),
      pavementType: z.enum(["JPCP_JRCP", "CRCP"]).optional().describe("for J when not given"),
      shoulder: z.enum(["asphalt", "tied_pcc"]).optional().describe("for J when not given (asphalt covers no shoulder)"),
      loadTransferDevices: z.boolean().optional().describe("dowels at joints (default true), for J"),
      Cd: z.number().optional().describe("drainage coefficient, default 1.0"),
      drainageQuality: quality, saturationExposure: exposure,
      roundTo: z.number().positive().optional().describe("rounding step: in (US, default 0.5) or mm (SI, default 10)"),
    }),
    run: (inp) => {
      const r = designRigid(inp);
      const si = r.units === "SI";
      return {
        result: r,
        display: stepsDisplay(`AASHTO 1993 rigid pavement (W18 = ${fmtInt(r.W18)})`, r.steps, r.notes, r.checks),
        summary: `AASHTO 1993 rigid: required slab D = ${r.D_required_in.toFixed(2)} in (${r.D_required_mm.toFixed(0)} mm), use ${si ? `${r.D_mm.toFixed(0)} mm (${r.D_in.toFixed(2)} in)` : `${r.D_in.toFixed(1)} in (${r.D_mm.toFixed(0)} mm)`} for W18 = ${fmtInt(r.W18)}, R = ${r.reliability} %, S'c = ${r.Sc_psi.toFixed(0)} psi, k = ${r.k_pci.toFixed(0)} pci, J = ${r.J}, Cd = ${r.Cd}.`,
      };
    },
  }),
  def({
    name: "traffic_esal",
    category: "transport",
    description: "Cumulative design traffic in ESAL / msa (million standard axles, 80 kN): N = 365·[(1+r)^n − 1]/r·A·D·L·F. Presets: RHD (Bangladesh national/regional roads: Table 3 factors large truck 4.8, medium truck 4.62, small truck 1.0, large bus 1.0, mini bus 0.5; 0.5 × two-way flow; National 10 %/Regional 7 % for 20 yr), LGED (Bangladesh rural: truck 1.0, bus 0.5, mini bus 0.2; single-lane ×2), IRC (IRC:37-2018 lane factors and indicative VDF), AASHTO (USA: D = 0.5, lane factor by lanes per direction; give truck factors per FHWA class or axle loads), generic. Give daily counts per class, or dailyVehicles with factor, or firstYearESAL. Output feeds pavement_flexible_aashto / pavement_rigid_aashto (W18) or pavement_rhd_catalogue (msa).",
    schema: z.object({
      method: z.enum(["generic", "RHD", "LGED", "IRC", "AASHTO"]).default("generic"),
      classes: z.array(z.object({
        name: z.string().describe("vehicle class, e.g. 'large truck', 'mini bus', 'FHWA class 9'"),
        perDay: z.number().nonnegative().describe("first-year daily count (two-way unless the distribution factors say otherwise)"),
        factor: z.number().nonnegative().optional().describe("equivalence / truck factor, ESAL per vehicle (preset for RHD/LGED classes)"),
        axles: z.array(z.object({ type: z.enum(["single", "tandem", "tridem"]), load: z.number().positive().describe("axle group load in axleLoadUnit") })).optional().describe("axle loads of one vehicle, to compute its factor as Σ LEF"),
      })).optional(),
      dailyVehicles: z.number().positive().optional().describe("first-year commercial vehicles per day A (use with factor)"),
      factor: z.number().positive().optional().describe("vehicle damage factor / truck factor F for dailyVehicles (IRC indicative VDF if omitted)"),
      firstYearESAL: z.number().positive().optional().describe("first-year annual ESAL instead of counts"),
      growthRate: z.number().min(0, "Growth rate must not be negative").optional().describe("% per year (RHD default 10 National / 7 Regional)"),
      designLife: z.number().positive("Design life must be greater than 0").optional().describe("years (RHD default 20)"),
      roadClass: z.enum(["National", "Regional"]).optional().describe("RHD road class"),
      directional: z.number().optional().describe("directional distribution D (defaults by method: AASHTO/RHD 0.5)"),
      lane: z.number().optional().describe("lane distribution L"),
      ircLaneCase: z.enum(["single_lane", "intermediate_lane", "two_lane", "four_lane_undivided", "dual_2_lane", "dual_3_lane", "dual_4_lane"]).optional().describe("IRC:37-2018 lane distribution case"),
      lanesPerDirection: z.number().int().min(1).max(4).optional().describe("AASHTO lane distribution: lanes in each direction"),
      singleLane: z.boolean().optional().describe("LGED single-lane road: 2 × two-way cumulative ESA"),
      terrain: z.enum(["plain", "hilly"]).optional().describe("IRC indicative VDF"),
      yearsToOpening: z.number().nonnegative().optional().describe("years between the count and opening: A = P·(1+r)^x"),
      axleLoadUnit: z.enum(["kN", "kip"]).optional().describe("unit of axle loads, default kN"),
      lefMethod: z.enum(["aashto", "fourth_power"]).optional().describe("LEF from axle loads: aashto flexible LEF equation (default) or the fourth-power approximation (single axles)"),
      lefSN: z.number().optional().describe("SN for the AASHTO LEF, default 5"), lefPt: z.number().optional().describe("pt for the AASHTO LEF, default 2.5"),
    }),
    run: (inp) => {
      const r = cumulativeESAL(inp);
      return {
        result: r,
        display: stepsDisplay(`Cumulative design traffic (${r.method})`, r.steps, r.notes, r.checks),
        summary: `Design traffic N = ${fmtInt(r.cumulativeESAL)} ESAL (${r.msa.toFixed(2)} msa) over ${r.designLife} years at ${r.growthRate} %/yr (growth factor ${r.growthFactor.toFixed(2)}, D = ${r.directional}, L = ${r.lane}${r.multiplier !== 1 ? `, ×${r.multiplier}` : ""}), ${r.method === "generic" ? "N = 365·GF·A·D·L·F" : `${r.method} method`}.`,
      };
    },
  }),
  def({
    name: "pavement_rhd_catalogue",
    category: "transport",
    description: "Bangladesh RHD Pavement Design Guide (2005) flexible pavement catalogue (Table 5): layer thicknesses (asphalt wearing 40 mm + asphalt base course, granular base Type I/II, sub-base, improved subgrade) from design traffic in msa (≤ 80) and soaked subgrade CBR. Use for RHD roads in Bangladesh; get msa from traffic_esal (method RHD). ≥ 30 msa needs a cement-bound base; strategic National roads should use pavement_flexible_aashto. Not for USA roads (use AASHTO 1993) or LGED rural roads.",
    schema: z.object({
      msa: z.number().positive("Design traffic must be greater than 0 msa").describe("design traffic, million standard axles (8,160 kg), ≤ 80"),
      subgradeCBR: z.number().positive("CBR must be greater than 0").describe("soaked subgrade CBR %"),
      baseType: z.enum(["I", "II"]).optional().describe("granular road base: Type I (CBR ≥ 80 %, default) or Type II (CBR ≥ 50 %)"),
      improvedSubgradeSource: z.enum(["appendix", "table6"]).optional().describe("improved subgrade values: appendix (Appendix 1, conservative, default) or table6"),
      roadClass: z.enum(["National", "Regional"]).optional(),
    }),
    run: (inp) => {
      const r = rhdFlexibleDesign(inp);
      const parts = r.layers.map((l) => `${l.layer.toLowerCase()} ${l.thickness_mm === null ? (l.layer.includes("base Type") ? "N/A (cement-bound base needed)" : "remove and replace") : `${l.thickness_mm} mm`}`);
      return {
        result: r,
        display: { kind: "table", title: `RHD 2005 flexible pavement: ${r.msa} msa, subgrade CBR ${r.subgradeCBR} %`, columns: ["Layer", "Thickness (mm)", "Material / note"], rows: [...r.layers.map((l) => [l.layer, l.thickness_mm ?? "N/A", l.spec]), ["Total", r.total_mm, r.ok ? "" : r.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")], ...r.notes.map((n) => ["Note", "", n])] },
        summary: `RHD Pavement Design Guide 2005 (Table 5): for ${r.msa} msa on CBR ${r.subgradeCBR} % use ${parts.join(", ")} (total ${r.total_mm} mm).`,
      };
    },
  }),
];
