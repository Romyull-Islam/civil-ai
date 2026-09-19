/**
 * Concrete mix-design tools (ACI 211.1 with ACI 318 or BNBC 2020 checks; IS 10262:2019 with IS 456). The engineering is in
 * src/lib/eng/mixdesign.ts; this file only maps tool inputs to it and formats the batch table, workbook and summary.
 */
import { z } from "zod";
import type { ToolDef } from "@/lib/tools";
import type { WorkbookSpec } from "@/lib/docs/workbook";
import { designAciMix, designIsMix, KG_M3_TO_LB_YD3, CEMENT_SACK_LB, LB_KG, type AciMixResult, type IsMixResult, type Batch, type Check } from "@/lib/eng/mixdesign";

const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t as unknown as ToolDef;

const f0 = (x: number) => Math.round(x);
const f1 = (x: number) => Number(x.toFixed(1));
const f2 = (x: number) => Number(x.toFixed(2));
const wcTxt = (x: number) => (Math.abs(x * 100 - Math.round(x * 100)) < 1e-6 ? x.toFixed(2) : x.toFixed(3));

type Row = (string | number)[];
type MixResult = AciMixResult | IsMixResult;

/** Batch table: one row per material, columns oven-dry / SSD / field per unit volume, field for the given volume, per cement bag. */
function batchTable(r: MixResult, us: boolean) {
  const k = us ? KG_M3_TO_LB_YD3 : 1; // kg/m³ → lb/yd³
  const mu = us ? "lb/yd³" : "kg/m³";
  const bag = us ? `Per ${CEMENT_SACK_LB}-lb sack (lb)` : "Per 50 kg bag (kg)";
  const fv = r.forVolume;
  const vUnit = fv ? (fv.unit === "m3" ? "m³" : fv.unit === "yd3" ? "yd³" : "cft") : "";
  const columns = ["Material", `Oven-dry aggregates (${mu})`, `SSD aggregates (${mu})`, `Field, moist (${mu})`, ...(fv ? [`Field for ${fv.volume} ${vUnit}${fv.wastagePercent ? ` + ${fv.wastagePercent}%` : ""} (${us ? "lb" : "kg"})`] : []), bag];
  const { dry, ssd, field } = r.batches;
  const perBag = r.perBag;
  const line = (label: string, key: keyof Batch, d = 0): Row => {
    const fmt = (x: number) => (d ? f1(x) : f0(x));
    // for a volume: kg, or lb; per bag: kg per 50 kg of cement, or lb per 94 lb of cement (same mass ratio)
    return [label, fmt(dry[key] * k), fmt(ssd[key] * k), fmt(field[key] * k), ...(fv ? [fmt(us ? fv.batch[key] / LB_KG : fv.batch[key])] : []), f1(us ? (perBag[key] * CEMENT_SACK_LB) / 50 : perBag[key])];
  };
  const bagsPer = us ? r.cementSacksPerYd3 : r.cementBagsPerM3;
  const rows: Row[] = [
    line(us ? "Water to add (lb)" : "Water to add (kg = L)", "water"),
    line(us ? "Cement (lb)" : "Cement (kg)", "cement"),
    [us ? "Cement sacks (94 lb)" : "Cement bags (50 kg)", f2(bagsPer), f2(bagsPer), f2(bagsPer), ...(fv ? [f1(us ? fv.cementSacks : fv.cementBags)] : []), 1],
    line(us ? "Coarse aggregate (lb)" : "Coarse aggregate / stone chips (kg)", "coarse"),
    line(us ? "Fine aggregate / sand (lb)" : "Fine aggregate / sand (kg)", "fine"),
  ];
  if (field.admixture > 0) rows.push(line(us ? "Admixture (lb)" : "Chemical admixture (kg)", "admixture", 1));
  rows.push(line(us ? "Total (lb)" : "Total (kg)", "total"));
  if (r.cft?.sandPerM3 !== undefined) rows.push(["Sand, loose (cft)", "", "", `${f1(r.cft.sandPerM3)} per m³`, ...(fv ? [fv.sandCft !== undefined ? f1(fv.sandCft) : ""] : []), f2(r.cft.sandPerBag!)]);
  if (r.cft?.stonePerM3 !== undefined) rows.push(["Stone chips, loose (cft)", "", "", `${f1(r.cft.stonePerM3)} per m³`, ...(fv ? [fv.stoneCft !== undefined ? f1(fv.stoneCft) : ""] : []), f2(r.cft.stonePerBag!)]);
  return { columns, rows };
}

/** Checks and warnings appended under the batch table so failures are visible in the card. */
function checkRows(checks: Check[], warnings: string[], width: number): Row[] {
  const pad = (a: string, b: string): Row => [a, b, ...Array(Math.max(0, width - 2)).fill("")];
  return [
    pad("", ""),
    ...checks.map((c) => pad(`${c.ok ? "✓" : "✗ FAILS"} ${c.name}`, c.detail)),
    ...warnings.map((w) => pad("⚠ Warning", w)),
  ];
}

function workbookFor(title: string, table: { columns: string[]; rows: Row[] }, r: MixResult): WorkbookSpec {
  return {
    title,
    sheets: [
      { name: "Batch quantities", title, columns: table.columns.map((h) => ({ header: h, width: h === "Material" ? 34 : 18 })), rows: table.rows, notes: ["Starting proportions for trial batches: confirm by trial mixes before use."] },
      { name: "Design steps", columns: [{ header: "No.", width: 6 }, { header: "Step", width: 140 }], rows: r.steps.map((s, i) => [i + 1, s]) },
      { name: "Checks and notes", columns: [{ header: "Item", width: 48 }, { header: "Detail", width: 110 }], rows: [...r.checks.map((c) => [`${c.ok ? "OK" : "FAILS"}: ${c.name}`, c.detail]), ...r.warnings.map((w) => ["Warning", w]), ...r.notes.map((n) => ["Note", n])] },
    ],
  };
}

function checksSummary(r: MixResult) {
  const failing = r.checks.filter((c) => !c.ok);
  return failing.length ? `CHECKS FAIL: ${failing.map((c) => `${c.name} (${c.detail})`).join("; ")}.` : "All checks pass.";
}

/** Compact result for the model: key numbers, batches, checks and notes (steps included so it can explain the design). */
function modelResult(r: MixResult, us: boolean, extra: Record<string, unknown>) {
  const k = us ? KG_M3_TO_LB_YD3 : 1;
  const roundK = (b: Batch, f: number) => ({ water: f1(b.water * f), cement: f1(b.cement * f), coarse: f1(b.coarse * f), fine: f1(b.fine * f), ...(b.admixture ? { admixture: f2(b.admixture * f) } : {}), total: f1(b.total * f) });
  const round = (b: Batch) => roundK(b, k);
  const bagF = us ? CEMENT_SACK_LB / 50 : 1;
  return {
    ...extra,
    unit: us ? "lb/yd³" : "kg/m³",
    wc: r.wc, wcGoverns: r.wcGoverns, air_percent: r.air,
    perUnitVolume: { ovenDry: round(r.batches.dry), ssd: round(r.batches.ssd), field: round(r.batches.field) },
    ...(us ? { perM3_kg: { ssd: roundK(r.batches.ssd, 1), field: roundK(r.batches.field, 1) } } : {}),
    cementBagsPerM3: f2(r.cementBagsPerM3), cementSacksPerYd3: f2(r.cementSacksPerYd3),
    perCementBag: { basis: us ? "field batch per 94-lb sack of cement, lb" : "field batch per 50 kg bag of cement, kg", water: f1(r.perBag.water * bagF), cement: us ? CEMENT_SACK_LB : 50, coarse: f1(r.perBag.coarse * bagF), fine: f1(r.perBag.fine * bagF), ...(r.perBag.admixture ? { admixture: f2(r.perBag.admixture * bagF) } : {}) },
    cft: r.cft,
    forVolume: r.forVolume ? { volume: r.forVolume.volume, unit: r.forVolume.unit, wastagePercent: r.forVolume.wastagePercent, kg: roundK(r.forVolume.batch, 1), ...(us ? { lb: roundK(r.forVolume.batch, 1 / LB_KG) } : {}), cementBags50kg: f1(r.forVolume.cementBags), cementSacks94lb: f1(r.forVolume.cementSacks), sandCft: r.forVolume.sandCft, stoneCft: r.forVolume.stoneCft } : undefined,
    ratioByMassSSD: r.ratio,
    checks: r.checks, warnings: r.warnings, notes: r.notes, steps: r.steps, allChecksPass: r.ok,
  };
}

const sgBasisDry = z.enum(["dry", "ssd"]);

export const MIX_TOOLS: ToolDef[] = [
  def({
    name: "mix_design_aci",
    category: "materials",
    description:
      "Concrete mix design by weight for a target strength, ACI 211.1 absolute-volume method: required average strength f'cr, w/c from strength and durability, water, air, cement, coarse and fine aggregate, moisture correction, and batch quantities per m³ (oven-dry, SSD, field), for a given volume and per 50 kg cement bag (lb/yd³ and 94-lb sacks with units US). " +
      "USA: code ACI318 (units US for psi/in./lb). Bangladesh: code BNBC2020 (BNBC Part 6 is ACI-based: BNBC f'cr, Table 6.5.6, Table 6.8.3 and exposure checks); use mix_design_is10262 only if the user asks for IS 10262. " +
      "Specific gravities are bulk oven-dry by default (sgBasis 'ssd' if SSD values are given). Results are starting proportions: always tell the user to confirm by trial mixes. " +
      "For material quantities of a nominal volume mix such as 1:2:4, use concrete_materials instead.",
    schema: z.object({
      units: z.enum(["SI", "US"]).default("SI").describe("SI: MPa, mm, kg/m³. US: psi, in., lb/ft³ in; lb/yd³ out"),
      code: z.enum(["ACI318", "BNBC2020"]).optional().describe("f'cr rules and durability checks: ACI318 (USA) or BNBC2020 (Bangladesh). Default BNBC2020 for SI, ACI318 for US"),
      fc: z.number().positive().describe("specified 28-day cylinder strength f'c, MPa (psi if US)"),
      stdDev: z.number().positive().optional().describe("standard deviation of the plant's test records, MPa (psi); omit if none"),
      numTests: z.number().int().positive().optional().describe("number of consecutive tests behind stdDev (≥ 15)"),
      fcrOverride: z.number().positive().optional().describe("required average strength f'cr if already known, MPa (psi)"),
      slump: z.number().positive().optional().describe("target slump, mm (in.); or give construction"),
      construction: z.enum(["footings_walls", "plain_footings_caissons", "beams_walls", "columns", "pavements_slabs", "mass"]).optional().describe("type of construction, picks the slump from ACI 211.1 Table A1.5.3.1 when slump is not given"),
      vibrated: z.boolean().optional().describe("default true; false adds 25 mm (1 in.) to the recommended slump"),
      nms: z.number().positive().describe("nominal maximum size of coarse aggregate, mm (in.): 9.5, 12.5, 19 (20), 25, 37.5 (40), 50…"),
      fm: z.number().min(1).max(4).describe("fineness modulus of the sand"),
      caDryRoddedDensity: z.number().positive().describe("oven-dry-rodded bulk density of the coarse aggregate (ASTM C29), kg/m³ (lb/ft³)"),
      caSG: z.number().min(1.5).max(4.5).describe("bulk specific gravity of the coarse aggregate"),
      faSG: z.number().min(1.5).max(4.5).describe("bulk specific gravity of the sand"),
      sgBasis: sgBasisDry.optional().describe("basis of caSG/faSG: dry (default, as ACI 211.1) or ssd"),
      caAbsorption: z.number().min(0).max(25).describe("coarse aggregate absorption, %"),
      faAbsorption: z.number().min(0).max(25).describe("sand absorption, %"),
      caMoisture: z.number().min(0).max(30).optional().describe("coarse aggregate total moisture at site, % of dry mass (default = absorption, SSD)"),
      faMoisture: z.number().min(0).max(30).optional().describe("sand total moisture at site, % of dry mass (default = absorption, SSD)"),
      cementSG: z.number().min(2.5).max(3.3).optional().describe("default 3.15"),
      airEntrained: z.boolean().optional().describe("air-entrained concrete (freeze-thaw exposure); default false"),
      airExposure: z.enum(["mild", "moderate", "severe"]).optional().describe("freeze-thaw exposure level for the recommended air content (default moderate)"),
      airOverride: z.number().min(0).max(12).optional().describe("total air %, replaces the table value"),
      roundedAggregate: z.boolean().optional().describe("rounded gravel instead of crushed stone (less water)"),
      roundedAdjustment: z.number().min(0).optional().describe("water reduction for rounded aggregate, kg/m³ (lb/yd³); default ACI 18 non-AE / 15 AE kg"),
      waterReducerPercent: z.number().min(0).max(40).optional().describe("water reduction by admixture, % (plasticiser 5–10, superplasticiser 20–30)"),
      waterOverride: z.number().positive().optional().describe("net mixing water, kg/m³ (lb/yd³), replaces the table and adjustments"),
      wcOverride: z.number().min(0.2).max(1).optional().describe("w/c for strength from trial mixes or field data; durability limits still apply"),
      allowPcaExtension: z.boolean().optional().describe("above the ACI 211.1 w/c table, use PCA EB001 Table 9-3 rows up to 45 MPa (default true, flagged)"),
      caVolumeAdjustPercent: z.number().min(-10).max(10).optional().describe("% change of the coarse aggregate volume: +10 pavements, up to −10 for pumping"),
      fineAggregateMethod: z.enum(["volume", "mass"]).optional().describe("sand by absolute volume (default) or by the estimated concrete mass"),
      freezeThaw: z.boolean().optional().describe("frequently wet and exposed to freezing and thawing"),
      seaWater: z.boolean().optional().describe("exposed to sea water, brackish water or their spray"),
      sulfate: z.enum(["none", "moderate", "severe", "very_severe"]).optional().describe("sulphate exposure (BNBC Table 6.5.2 classes)"),
      thinSection: z.boolean().optional().describe("thin section (railings, curbs, sills) or cover < 25 mm, ACI 211.1 Table A1.5.3.4(b)"),
      sulfateResistingCement: z.boolean().optional().describe("Type II or V cement (+0.05 w/c for sea water/sulphate in ACI 211.1)"),
      environment: z.enum(["mild", "moderate", "severe", "very_severe", "extreme"]).optional().describe("BNBC Table 6.8.3 exposure (default mild)"),
      corrosive: z.boolean().optional().describe("BNBC 8.1.7.8 corrosive or other severe environment (coastal, industrial)"),
      lowPermeability: z.boolean().optional().describe("concrete must have low permeability to water (BNBC 5.5.1.1)"),
      extraCover12mm: z.boolean().optional().describe("cover increased by 12 mm (BNBC 5.5.1.2 allows w/c 0.45 in sea water)"),
      upTo4Storeys: z.boolean().optional().describe("building up to 4 storeys: BNBC minimum f'c 17 instead of 20 MPa"),
      element: z.enum(["general", "pile", "large_pile"]).optional().describe("pile: tremie pile ≤ 10 m, min cement 350; large_pile: larger/deeper, 400 kg/m³ (BNBC)"),
      brickAggregate: z.boolean().optional().describe("brick chips (khoa) as coarse aggregate"),
      maxWc: z.number().min(0.2).max(1).optional().describe("maximum w/c from the project specification"),
      minCement: z.number().positive().optional().describe("minimum cement from the project specification, kg/m³ (lb/yd³)"),
      volume: z.number().positive().optional().describe("concrete volume to batch, in volumeUnit"),
      volumeUnit: z.enum(["m3", "cft", "yd3"]).optional().describe("default m3 (SI) or yd3 (US)"),
      wastagePercent: z.number().min(0).max(50).optional().describe("added to the volume quantities only (default 0)"),
      sandLooseDensity: z.number().positive().optional().describe("loose bulk density of the sand as delivered, kg/m³ (lb/ft³), to give cft"),
      stoneLooseDensity: z.number().positive().optional().describe("loose bulk density of the stone chips as delivered, kg/m³ (lb/ft³), to give cft"),
    }),
    run: (inp) => {
      const r = designAciMix(inp);
      const us = r.units === "US";
      const su = r.strengthUnit;
      const codeLabel = r.code === "BNBC2020" ? "BNBC 2020" : "ACI 318";
      const title = `ACI 211.1 mix (${codeLabel}): f'c ${inp.fc} ${su}, f'cr ${us && su === "psi" ? f0(r.fcr) : f1(r.fcr)} ${su}, w/c ${wcTxt(r.wc)}, slump ${r.slump} ${us ? "in." : "mm"}, ${r.nms} ${us ? "in." : "mm"} aggregate${r.airEntrained ? `, ${f1(r.air)}% air` : ""}`;
      const table = batchTable(r, us);
      const rows = [...table.rows, ...checkRows(r.checks, r.warnings, table.columns.length)];
      const k = us ? KG_M3_TO_LB_YD3 : 1;
      const mu = us ? "lb/yd³" : "kg/m³";
      const fd = r.batches.field;
      const bags = us ? `${f2(r.cementSacksPerYd3)} sacks` : `${f2(r.cementBagsPerM3)} bags`;
      const fv = r.forVolume;
      const vol = fv ? ` For ${fv.volume} ${fv.unit === "m3" ? "m³" : fv.unit === "yd3" ? "yd³" : "cft"}${fv.wastagePercent ? ` (+${fv.wastagePercent}%)` : ""}: cement ${us ? `${f0(fv.batch.cement / LB_KG)} lb (${f1(fv.cementSacks)} sacks)` : `${f0(fv.batch.cement)} kg (${f1(fv.cementBags)} bags)`}, stone ${us ? `${f0(fv.batch.coarse / LB_KG)} lb` : `${f0(fv.batch.coarse)} kg`}, sand ${us ? `${f0(fv.batch.fine / LB_KG)} lb` : `${f0(fv.batch.fine)} kg`}, water ${us ? `${f0(fv.batch.water / LB_KG)} lb` : `${f0(fv.batch.water)} L`}.` : "";
      const summary = `${codeLabel} / ACI 211.1: f'cr ${us && su === "psi" ? f0(r.fcr) : f1(r.fcr)} ${su}, w/c ${wcTxt(r.wc)} (${r.wcGoverns}). Per ${us ? "yd³" : "m³"} (field): water ${f0(fd.water * k)}, cement ${f0(fd.cement * k)} (${bags}), coarse ${f0(fd.coarse * k)}, sand ${f0(fd.fine * k)} ${mu}; SSD mix by mass 1:${r.ratio.split(" : ").slice(1).join(":")}.${vol} ${checksSummary(r)} Starting proportions: confirm by trial mixes.`;
      return {
        result: modelResult(r, us, { method: r.method, code: r.code, units: r.units, fc: inp.fc, fcr: f2(r.fcr), fcr_MPa: f2(r.fcrMPa), strengthUnit: su, wcStrength: r.wcStrength, slump: r.slump, nms: r.nms }),
        display: { kind: "table", title, columns: table.columns, rows },
        workbook: workbookFor(title, table, r),
        summary,
      };
    },
  }),
  def({
    name: "mix_design_is10262",
    category: "materials",
    description:
      "Concrete mix design by IS 10262:2019 (Indian Standard, grades M10–M60) with IS 456:2000 durability (Table 5 exposure: max w/c, min/max cement, min grade): target strength, w/c, water (slump, aggregate shape and admixture adjustments), coarse/fine aggregate by absolute volume on SSD basis, oven-dry and field corrections, bags per m³, quantities for a volume and per 50 kg bag. " +
      "Use it when the user asks for IS 10262 (India, or Bangladesh on request); for Bangladesh by default use mix_design_aci with code BNBC2020, and for the USA mix_design_aci with ACI318. " +
      "The w/c from IS 10262 Fig. 1 is an approximate digitised reading unless wcOverride (from trials) is given. Results are starting proportions: always tell the user to confirm by trial mixes. " +
      "For material quantities of a nominal volume mix such as 1:2:4, use concrete_materials instead.",
    schema: z.object({
      fck: z.number().min(10).max(60).describe("characteristic cube strength fck, MPa (M20 → 20)"),
      stdDev: z.number().positive().optional().describe("standard deviation from ≥ 30 test results, MPa; omit to use IS 10262 Table 2"),
      siteControl: z.enum(["good", "fair"]).optional().describe("fair adds 1 MPa to the assumed standard deviation (default good)"),
      nms: z.number().positive().describe("nominal maximum aggregate size, mm (10, 20, 40)"),
      slump: z.number().positive().describe("target slump, mm"),
      aggregateShape: z.enum(["angular", "sub_angular", "gravel_crushed", "rounded"]).optional().describe("default angular (crushed)"),
      zone: z.enum(["I", "II", "III", "IV"]).describe("grading zone of the sand (IS 383)"),
      cementType: z.enum(["OPC33", "OPC43", "OPC53", "PPC", "PSC"]).optional().describe("selects the Fig. 1 curve (default OPC43; PPC/PSC → curve 2)"),
      cementStrength: z.number().positive().optional().describe("measured 28-day cement strength, MPa (selects the Fig. 1 curve)"),
      cementSG: z.number().min(2.5).max(3.3).optional().describe("default 3.15 (PPC is often 2.8–2.9: give the tested value)"),
      caSG: z.number().min(1.5).max(4.5).describe("specific gravity of the coarse aggregate"),
      faSG: z.number().min(1.5).max(4.5).describe("specific gravity of the sand"),
      sgBasis: sgBasisDry.optional().describe("basis of caSG/faSG: ssd (default, as IS 10262) or dry"),
      caAbsorption: z.number().min(0).max(25).describe("coarse aggregate water absorption, %"),
      faAbsorption: z.number().min(0).max(25).describe("sand water absorption, %"),
      caMoisture: z.number().min(0).max(30).optional().describe("coarse aggregate total moisture, % of dry mass (0 = oven-dry; default SSD)"),
      faMoisture: z.number().min(0).max(30).optional().describe("sand total moisture, % of dry mass (0 = oven-dry; default SSD)"),
      admixtureDosagePercent: z.number().min(0).max(5).optional().describe("chemical admixture dosage, % by mass of cement"),
      admixtureSG: z.number().min(0.9).max(1.5).optional().describe("admixture specific gravity (default 1.145)"),
      waterReductionPercent: z.number().min(0).max(40).optional().describe("water reduction by the admixture, % (plasticiser 5–10, superplasticiser 20–30)"),
      wcOverride: z.number().min(0.2).max(0.8).optional().describe("free w/c from trials or read from Fig. 1; IS 456 limits still apply"),
      waterOverride: z.number().positive().optional().describe("water, kg/m³, replaces Table 4 and adjustments"),
      exposure: z.enum(["mild", "moderate", "severe", "very_severe", "extreme"]).describe("IS 456 Table 3 exposure condition"),
      concreteType: z.enum(["RCC", "PCC"]).optional().describe("reinforced (default) or plain concrete"),
      pumpReductionPercent: z.number().min(0).max(10).optional().describe("reduce the coarse aggregate volume up to 10% for pumping or congested steel"),
      minCement: z.number().positive().optional().describe("project minimum cement, kg/m³"),
      maxCement: z.number().positive().optional().describe("maximum cement, kg/m³ (default 450, IS 456 cl. 8.2.4.2)"),
      maxWc: z.number().min(0.2).max(0.8).optional().describe("project maximum w/c"),
      volume: z.number().positive().optional().describe("concrete volume to batch, in volumeUnit"),
      volumeUnit: z.enum(["m3", "cft", "yd3"]).optional().describe("default m3"),
      wastagePercent: z.number().min(0).max(50).optional().describe("added to the volume quantities only (default 0)"),
      sandLooseDensity: z.number().positive().optional().describe("loose bulk density of the sand as delivered, kg/m³, to give cft"),
      stoneLooseDensity: z.number().positive().optional().describe("loose bulk density of the stone chips as delivered, kg/m³, to give cft"),
    }),
    run: (inp) => {
      const r = designIsMix(inp);
      const title = `IS 10262 mix M${inp.fck}: f'ck ${f2(r.targetStrength)} MPa, w/c ${wcTxt(r.wc)}, slump ${inp.slump} mm, ${inp.nms} mm aggregate, ${inp.exposure.replace("_", " ")} exposure (${r.concreteType})`;
      const table = batchTable(r, false);
      const rows = [...table.rows, ...checkRows(r.checks, r.warnings, table.columns.length)];
      const fd = r.batches.field;
      const fv = r.forVolume;
      const vol = fv ? ` For ${fv.volume} ${fv.unit === "m3" ? "m³" : fv.unit === "yd3" ? "yd³" : "cft"}${fv.wastagePercent ? ` (+${fv.wastagePercent}%)` : ""}: cement ${f0(fv.batch.cement)} kg (${f1(fv.cementBags)} bags), stone ${f0(fv.batch.coarse)} kg, sand ${f0(fv.batch.fine)} kg, water ${f0(fv.batch.water)} L.` : "";
      const summary = `IS 10262:2019: f'ck ${f2(r.targetStrength)} MPa, free w/c ${wcTxt(r.wc)} (${r.wcGoverns}). Per m³ (field): water ${f0(fd.water)}, cement ${f0(fd.cement)} (${f2(r.cementBagsPerM3)} bags), coarse ${f0(fd.coarse)}, sand ${f0(fd.fine)} kg${fd.admixture ? `, admixture ${f2(fd.admixture)} kg` : ""}; SSD mix by mass 1:${r.ratio.split(" : ").slice(1).join(":")}.${vol} ${checksSummary(r)} Starting proportions: confirm by trial mixes.`;
      return {
        result: modelResult(r, false, { method: r.method, fck: inp.fck, targetStrength_MPa: f2(r.targetStrength), S: r.S, X: r.X, wcStrength: r.wcStrength, exposure: r.exposure, concreteType: r.concreteType, coarseFraction: f2(r.coarseFraction) }),
        display: { kind: "table", title, columns: table.columns, rows },
        workbook: workbookFor(title, table, r),
        summary,
      };
    },
  }),
];
