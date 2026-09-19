/**
 * Landscape quantities and irrigation.
 *  - Plants for an area: square spacing needs area/s² plants; triangular (offset rows) packs each plant in a hexagon of
 *    area (√3/2)s² = 0.866s², so area/(0.866s²) plants (15.5% more). Rows (hedges, street trees): L/s + 1.
 *  - Bulk materials (topsoil, mulch, gravel, compost): volume = area × depth, plus settlement/compaction allowance,
 *    in m³ or cubic yards and in bags (litres or cubic feet).
 *  - Water budget, California Model Water Efficient Landscape Ordinance (23 CCR ch. 2.7, Appendix A worksheet):
 *    MAWA = ETo × 0.62 × [ETAF × RLA + 1.0 × SLA] with ETAF 0.55 residential, 0.45 non-residential;
 *    estimated use per hydrozone = (plant factor / irrigation efficiency) × area × ETo × 0.62 (gallons/year, ETo in
 *    in/yr, area in ft²; 1 in over 1 ft² = 0.623 gal). Irrigation efficiency 0.75 overhead, 0.81 drip. SI: litres =
 *    ETo (mm) × area (m²) × factor, since 1 mm over 1 m² is 1 litre.
 *  - Sprinkler precipitation rate PR = 96.3 × Q(gpm)/A(ft²) in/h (1 gpm on 1 ft² for an hour = 96.25 in),
 *    or 60 × Q(L/min)/A(m²) mm/h; run time = required depth / (PR × distribution uniformity).
 */
export type LUnits = "SI" | "US";
const TRI = Math.sqrt(3) / 2;

export function plantsForArea(area: number, spacing: number, pattern: "square" | "triangular" = "triangular") {
  if (!(area > 0 && spacing > 0)) throw new Error("Area and spacing must be positive");
  const per = spacing * spacing * (pattern === "triangular" ? TRI : 1);
  return { plants: Math.ceil(area / per - 1e-9), areaPerPlant: per };
}
export const plantsForRow = (length: number, spacing: number, bothEnds = true) => { if (!(length > 0 && spacing > 0)) throw new Error("Length and spacing must be positive"); return Math.floor(length / spacing + 1e-9) + (bothEnds ? 1 : 0); };

/** Bulk material for an area at a depth. SI: area m², depth mm, bag litres; US: area ft², depth in, bag ft³. */
export function bulkMaterial(area: number, depth: number, units: LUnits = "SI", bagSize?: number, allowancePercent = 10) {
  if (!(area > 0 && depth > 0)) throw new Error("Area and depth must be positive");
  const f = 1 + allowancePercent / 100;
  if (units === "US") {
    const cuft = area * (depth / 12) * f;
    const bag = bagSize ?? 2;
    return { volume: cuft / 27, unit: "yd³", cubicFeet: cuft, bags: Math.ceil(cuft / bag - 1e-9), bagSize: bag, bagUnit: "ft³" };
  }
  const m3 = area * (depth / 1000) * f;
  const bag = bagSize ?? 50;
  return { volume: m3, unit: "m³", litres: m3 * 1000, bags: Math.ceil((m3 * 1000) / bag - 1e-9), bagSize: bag, bagUnit: "L" };
}

export interface Hydrozone { name?: string; area: number; plantFactor: number; irrigation?: "overhead" | "drip"; efficiency?: number; special?: boolean }
export function waterBudget(inp: { units?: LUnits; eto: number; zones: Hydrozone[]; use?: "residential" | "non_residential" }) {
  const us = inp.units !== "SI";
  const k = us ? 0.62 : 1; // gallons per (inch·ft²) or litres per (mm·m²)
  const etaf = inp.use === "non_residential" ? 0.45 : 0.55;
  if (!(inp.eto > 0) || !inp.zones?.length) throw new Error("Give the annual reference evapotranspiration ETo and at least one hydrozone");
  let rla = 0, sla = 0;
  const rows = inp.zones.map((z) => {
    if (!(z.area > 0) || !(z.plantFactor >= 0 && z.plantFactor <= 1)) throw new Error("Each hydrozone needs an area and a plant factor between 0 and 1");
    const ie = z.efficiency ?? (z.irrigation === "drip" ? 0.81 : 0.75);
    if (z.special) sla += z.area; else rla += z.area;
    const use = (z.plantFactor / ie) * z.area * inp.eto * k;
    return { name: z.name ?? "", area: z.area, plantFactor: z.plantFactor, efficiency: ie, etaf: z.plantFactor / ie, use, special: !!z.special };
  });
  const mawa = inp.eto * k * (etaf * rla + 1.0 * sla);
  const etwu = rows.reduce((s, r) => s + r.use, 0);
  const regularEtaf = rla ? rows.filter((r) => !r.special).reduce((s, r) => s + r.etaf * r.area, 0) / rla : 0;
  return { unit: us ? "gallons/year" : "litres/year", etafLimit: etaf, regularArea: rla, specialArea: sla, zones: rows, mawa, etwu, averageEtaf: regularEtaf, ok: etwu <= mawa + 1e-9 };
}

/** Sprinkler precipitation rate and weekly run time. US: flow gpm, area ft², depth in; SI: flow L/min, area m², depth mm. */
export function sprinkler(inp: { units?: LUnits; flow: number; area?: number; spacing?: number; rowSpacing?: number; pattern?: "square" | "triangular"; depthPerWeek: number; distributionUniformity?: number }) {
  const us = inp.units !== "SI";
  const area = inp.area ?? (inp.spacing ? (inp.pattern === "triangular" ? inp.spacing * inp.spacing * TRI : inp.spacing * (inp.rowSpacing ?? inp.spacing)) : NaN);
  if (!(inp.flow > 0 && area > 0 && inp.depthPerWeek > 0)) throw new Error("Give the flow, the area (or head spacing) and the water depth per week");
  const pr = us ? (96.3 * inp.flow) / area : (60 * inp.flow) / area;
  const du = inp.distributionUniformity ?? 0.75;
  const minutes = (inp.depthPerWeek / (pr * du)) * 60;
  return { precipitationRate: pr, unit: us ? "in/h" : "mm/h", area, distributionUniformity: du, minutesPerWeek: minutes };
}
