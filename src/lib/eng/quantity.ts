/** Quantity estimation / BOQ helpers. Units: m, m², m³, kg. */

export const NOMINAL_MIXES: Record<string, { cement: number; sand: number; aggregate: number }> = {
  M5: { cement: 1, sand: 5, aggregate: 10 },
  M7_5: { cement: 1, sand: 4, aggregate: 8 },
  M10: { cement: 1, sand: 3, aggregate: 6 },
  M15: { cement: 1, sand: 2, aggregate: 4 },
  M20: { cement: 1, sand: 1.5, aggregate: 3 },
  M25: { cement: 1, sand: 1, aggregate: 2 },
};

export const CEMENT_BAG_KG = 50;
export const CEMENT_DENSITY = 1440; // kg/m³ (bulk)
export const DRY_VOLUME_FACTOR = 1.54;
export const STEEL_DENSITY = 7850;

export function concreteMaterials(volume: number, grade: keyof typeof NOMINAL_MIXES | string, wastagePercent = 3) {
  const key = grade.replace(".", "_").toUpperCase();
  const mix = NOMINAL_MIXES[key];
  if (!mix) throw new Error(`Unknown nominal mix "${grade}". Use one of ${Object.keys(NOMINAL_MIXES).join(", ")}. For M30+ use design mix.`);
  const dry = volume * DRY_VOLUME_FACTOR * (1 + wastagePercent / 100);
  const sum = mix.cement + mix.sand + mix.aggregate;
  const cementVol = (dry * mix.cement) / sum;
  const cementKg = cementVol * CEMENT_DENSITY;
  return {
    grade: key,
    ratio: `1:${mix.sand}:${mix.aggregate}`,
    wetVolume: volume,
    dryVolume: dry,
    cement: { m3: cementVol, kg: cementKg, bags: Math.ceil(cementKg / CEMENT_BAG_KG) },
    sand: { m3: (dry * mix.sand) / sum, cft: ((dry * mix.sand) / sum) * 35.3147 },
    aggregate: { m3: (dry * mix.aggregate) / sum, cft: ((dry * mix.aggregate) / sum) * 35.3147 },
    water: { liters: cementKg * 0.5 },
    notes: [`Dry volume factor ${DRY_VOLUME_FACTOR}, wastage ${wastagePercent}%`, "Water/cement ratio assumed 0.5 for estimate."],
  };
}

/** Steel weight per metre: d²/162 kg/m (d in mm). */
export const rebarKgPerM = (d: number) => (d * d) / 162;

export interface RebarItem { diameter: number; length: number; count: number; label?: string }
export function rebarSchedule(items: RebarItem[], wastagePercent = 3) {
  const rows = items.map((it) => {
    const total = it.length * it.count;
    const kg = total * rebarKgPerM(it.diameter);
    return { ...it, unitWeight: rebarKgPerM(it.diameter), totalLength: total, weightKg: kg };
  });
  const byDia: Record<string, number> = {};
  for (const r of rows) byDia[`Ø${r.diameter}`] = (byDia[`Ø${r.diameter}`] ?? 0) + r.weightKg;
  const total = rows.reduce((s, r) => s + r.weightKg, 0);
  return { rows, totalsByDiameter: byDia, totalKg: total, totalWithWastageKg: total * (1 + wastagePercent / 100) };
}

export function brickMasonry(wallVolume: number, brick = { l: 0.19, w: 0.09, h: 0.09 }, mortarThickness = 0.01, mortarRatio = 4) {
  const bl = brick.l + mortarThickness;
  const bw = brick.w + mortarThickness;
  const bh = brick.h + mortarThickness;
  const perM3 = 1 / (bl * bw * bh);
  const bricks = wallVolume * perM3;
  const brickVol = bricks * brick.l * brick.w * brick.h;
  const wetMortar = wallVolume - brickVol;
  const dryMortar = wetMortar * 1.33 * 1.05; // dry factor + wastage
  const cementVol = dryMortar / (1 + mortarRatio);
  const cementKg = cementVol * CEMENT_DENSITY;
  return {
    bricksPerM3: perM3,
    bricks: Math.ceil(bricks * 1.05),
    mortarWetM3: wetMortar,
    mortarDryM3: dryMortar,
    cement: { kg: cementKg, bags: Math.ceil(cementKg / CEMENT_BAG_KG) },
    sand: { m3: (dryMortar * mortarRatio) / (1 + mortarRatio) },
    notes: [`Brick ${brick.l * 1000}×${brick.w * 1000}×${brick.h * 1000} mm with ${mortarThickness * 1000} mm mortar (1:${mortarRatio}); 5% wastage on bricks.`],
  };
}

export function plasterQuantity(area: number, thickness = 0.012, mortarRatio = 4) {
  const wet = area * thickness;
  const dry = wet * 1.27 * 1.2; // dry factor + 20% for undulation/wastage
  const cementVol = dry / (1 + mortarRatio);
  const cementKg = cementVol * CEMENT_DENSITY;
  return { wetVolume: wet, dryVolume: dry, cement: { kg: cementKg, bags: Math.ceil(cementKg / CEMENT_BAG_KG) }, sand: { m3: (dry * mortarRatio) / (1 + mortarRatio) }, notes: [`${thickness * 1000} mm plaster 1:${mortarRatio}, 27% dry factor + 20% wastage.`] };
}

export function paintQuantity(area: number, coats = 2, coveragePerLiter = 10) {
  return { area, coats, liters: (area * coats) / coveragePerLiter, note: `Coverage ${coveragePerLiter} m²/L per coat.` };
}

export function tileQuantity(area: number, tile = { l: 0.6, w: 0.6 }, wastagePercent = 7) {
  const per = 1 / (tile.l * tile.w);
  return { tilesPerM2: per, tiles: Math.ceil(area * per * (1 + wastagePercent / 100)), boxesOf4: Math.ceil((area * per * (1 + wastagePercent / 100)) / 4) };
}

export function excavation(length: number, width: number, depth: number, workingSpace = 0, bulkingPercent = 25) {
  const l = length + 2 * workingSpace;
  const w = width + 2 * workingSpace;
  const vol = l * w * depth;
  return { length: l, width: w, depth, volume: vol, loosVolume: vol * (1 + bulkingPercent / 100), truckTrips6m3: Math.ceil((vol * (1 + bulkingPercent / 100)) / 6) };
}
