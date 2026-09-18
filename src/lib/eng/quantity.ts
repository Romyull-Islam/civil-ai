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

export const CFT_PER_M3 = 35.3147;

/** Parse "M20" or a volume ratio like "1:2:4" / "1 : 1.5 : 3" into cement:sand:aggregate parts. */
export function parseMix(mix: string): { cement: number; sand: number; aggregate: number; grade?: string } {
  const parts = mix.split(/\s*[:：]\s*/).map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    const [cement, sand, aggregate] = parts.map((n) => n / parts[0]);
    const grade = Object.entries(NOMINAL_MIXES).find(([, m]) => m.sand === sand && m.aggregate === aggregate)?.[0];
    return { cement, sand, aggregate, grade };
  }
  const key = mix.trim().replace(".", "_").toUpperCase();
  const m = NOMINAL_MIXES[key];
  if (!m) throw new Error(`Unknown mix "${mix}". Give a ratio such as 1:2:4, or one of ${Object.keys(NOMINAL_MIXES).join(", ")}. For M30+ use a design mix.`);
  return { ...m, grade: key };
}

const fmt = (n: number, d = 2) => Number(n.toFixed(d)).toString();
const ratioText = (m: { sand: number; aggregate: number }) => `1:${fmt(m.sand)}:${fmt(m.aggregate)}`;

/**
 * Cement, sand and aggregate for a volume of nominal (volume-batched) concrete.
 * `mix` is a ratio ("1:2:4") or a grade ("M20"). When both are known and disagree, the ratio wins and a note says so.
 */
export function concreteMaterials(volume: number, mix: string, wastagePercent = 3, opts: { unit?: "m3" | "cft"; grade?: string } = {}) {
  const m = parseMix(mix);
  const notes: string[] = [];
  if (opts.grade) {
    const g = opts.grade.trim().replace(".", "_").toUpperCase();
    const named = NOMINAL_MIXES[g];
    if (named && (named.sand !== m.sand || named.aggregate !== m.aggregate))
      notes.push(`In IS 456 nominal mixes ${g} is ${ratioText(named)} and ${ratioText(m)} is ${m.grade ?? "not a standard grade"}. Quantities use ${ratioText(m)} as given; the strength of a volume mix depends on the materials, so confirm it with cylinder or cube tests.`);
  }
  const cft = opts.unit === "cft";
  const wetM3 = cft ? volume / CFT_PER_M3 : volume;
  const dry = wetM3 * DRY_VOLUME_FACTOR * (1 + wastagePercent / 100);
  const sum = m.cement + m.sand + m.aggregate;
  const cementM3 = (dry * m.cement) / sum;
  const cementKg = cementM3 * CEMENT_DENSITY;
  const bagsExact = cementKg / CEMENT_BAG_KG;
  const sandM3 = (dry * m.sand) / sum;
  const aggM3 = (dry * m.aggregate) / sum;
  const u = cft ? "cft" : "m³";
  const inU = (x: number) => (cft ? x * CFT_PER_M3 : x);
  const steps = [
    `Wet volume ${fmt(volume)} ${u}${cft ? ` = ${fmt(wetM3, 3)} m³` : ""}`,
    `Dry volume = ${fmt(volume)} × ${DRY_VOLUME_FACTOR}${wastagePercent ? ` × ${fmt(1 + wastagePercent / 100)} (wastage ${wastagePercent}%)` : ""} = ${fmt(inU(dry), 1)} ${u}`,
    `Mix ${ratioText(m)}, sum of parts = ${fmt(sum)}`,
    `Cement = ${fmt(inU(dry), 1)} × 1/${fmt(sum)} = ${fmt(inU(cementM3), 2)} ${u} → × ${CEMENT_DENSITY} kg/m³ = ${fmt(cementKg, 0)} kg ÷ ${CEMENT_BAG_KG} kg = ${fmt(bagsExact, 1)} bags → ${Math.ceil(bagsExact)} bags`,
    `Sand = ${fmt(inU(dry), 1)} × ${fmt(m.sand)}/${fmt(sum)} = ${fmt(inU(sandM3), 1)} ${u}`,
    `Coarse aggregate (stone chips) = ${fmt(inU(dry), 1)} × ${fmt(m.aggregate)}/${fmt(sum)} = ${fmt(inU(aggM3), 1)} ${u}`,
  ];
  return {
    grade: m.grade ?? null,
    ratio: ratioText(m),
    wetVolume: volume,
    unit: cft ? "cft" : "m3",
    dryVolume: inU(dry),
    cement: { m3: cementM3, cft: cementM3 * CFT_PER_M3, kg: cementKg, bagsExact, bags: Math.ceil(bagsExact) },
    sand: { m3: sandM3, cft: sandM3 * CFT_PER_M3 },
    aggregate: { m3: aggM3, cft: aggM3 * CFT_PER_M3 },
    water: { liters: cementKg * 0.5 },
    steps,
    notes: [...notes, `Dry volume factor ${DRY_VOLUME_FACTOR}, wastage ${wastagePercent}%, cement bag ${CEMENT_BAG_KG} kg (${fmt(CEMENT_BAG_KG / CEMENT_DENSITY * CFT_PER_M3)} cft) at ${CEMENT_DENSITY} kg/m³.`, "Water/cement ratio 0.5 assumed for the estimate."],
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
