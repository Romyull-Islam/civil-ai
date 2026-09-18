/**
 * Unit conversion utilities. All internal engineering calculations use SI:
 * length m / mm, force N / kN, stress MPa (N/mm²), moment kN·m.
 */

export type UnitCategory =
  | "length"
  | "area"
  | "volume"
  | "force"
  | "stress"
  | "moment"
  | "mass"
  | "density"
  | "distributed_load"
  | "temperature";

// Factor to convert *from* the unit *to* the SI base of its category.
const FACTORS: Record<UnitCategory, Record<string, number>> = {
  length: { m: 1, mm: 1e-3, cm: 1e-2, km: 1e3, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  area: { "m2": 1, "mm2": 1e-6, "cm2": 1e-4, "ha": 1e4, "in2": 0.00064516, "ft2": 0.09290304, "yd2": 0.83612736, "acre": 4046.8564224, katha: 66.89, decimal: 40.4686, bigha: 1337.8, shotangsho: 40.4686 },
  volume: { "m3": 1, "mm3": 1e-9, "cm3": 1e-6, "L": 1e-3, "ft3": 0.028316846592, "yd3": 0.764554857984, "gal_us": 0.003785411784, "in3": 1.6387064e-5 },
  force: { N: 1, kN: 1e3, MN: 1e6, kgf: 9.80665, tf: 9806.65, lbf: 4.4482216152605, kip: 4448.2216152605 },
  stress: { Pa: 1, kPa: 1e3, MPa: 1e6, GPa: 1e9, "N/mm2": 1e6, "kN/m2": 1e3, psi: 6894.757293168, ksi: 6894757.293168, "kgf/cm2": 98066.5, bar: 1e5 },
  moment: { "N.m": 1, "kN.m": 1e3, "N.mm": 1e-3, "kN.mm": 1, "lbf.ft": 1.3558179483314, "kip.ft": 1355.8179483314, "kip.in": 112.98484533333 },
  mass: { kg: 1, g: 1e-3, t: 1e3, lb: 0.45359237, ton_us: 907.18474, ton_uk: 1016.0469088 },
  density: { "kg/m3": 1, "g/cm3": 1000, "lb/ft3": 16.018463373960, "kN/m3": 101.9716213 },
  distributed_load: { "N/m": 1, "kN/m": 1e3, "lbf/ft": 14.593902937206, "kip/ft": 14593.902937206, "kN/m2": 1e3, "N/m2": 1, "psf": 47.880258980336 },
  temperature: { C: 1, F: 1, K: 1 },
};

export const UNIT_CATALOG: Record<UnitCategory, string[]> = Object.fromEntries(
  Object.entries(FACTORS).map(([k, v]) => [k, Object.keys(v)]),
) as Record<UnitCategory, string[]>;

function normalize(u: string): string {
  return u
    .trim()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/·|\*/g, ".")
    .replace(/\s+/g, "")
    .replace(/^kNm$/i, "kN.m")
    .replace(/^Nm$/i, "N.m")
    .replace(/^kipft$/i, "kip.ft")
    .replace(/^meters?$|^metres?$/i, "m")
    .replace(/^feet$|^foot$/i, "ft")
    .replace(/^inch(es)?$/i, "in")
    .replace(/^sqm$|^m\^2$/i, "m2")
    .replace(/^sqft$|^ft\^2$|^sft$/i, "ft2")
    .replace(/^kathas?$|^katha$/i, "katha")
    .replace(/^decimals?$|^dec$/i, "decimal")
    .replace(/^bighas?$/i, "bigha")
    .replace(/^cum$|^m\^3$/i, "m3")
    .replace(/^cft$|^ft\^3$/i, "ft3")
    .replace(/^tonnes?$/i, "t")
    .replace(/^litres?$|^liters?$|^l$/i, "L");
}

export function findCategories(unit: string): UnitCategory[] {
  const u = normalize(unit);
  const out: UnitCategory[] = [];
  for (const [cat, table] of Object.entries(FACTORS)) {
    if (u in table || Object.keys(table).some((k) => k.toLowerCase() === u.toLowerCase())) out.push(cat as UnitCategory);
  }
  return out;
}

export function findCategory(unit: string): UnitCategory | undefined {
  return findCategories(unit)[0];
}

function factor(cat: UnitCategory, unit: string): number {
  const table = FACTORS[cat];
  const u = normalize(unit);
  if (u in table) return table[u];
  const key = Object.keys(table).find((k) => k.toLowerCase() === u.toLowerCase());
  if (!key) throw new Error(`Unknown ${cat} unit "${unit}". Known: ${Object.keys(table).join(", ")}`);
  return table[key];
}

export function convert(value: number, from: string, to: string): { value: number; category: UnitCategory } {
  const catsFrom = findCategories(from);
  if (!catsFrom.length) throw new Error(`Unknown unit "${from}"`);
  const catsTo = findCategories(to);
  if (!catsTo.length) throw new Error(`Unknown unit "${to}"`);
  const cat = catsFrom.find((c) => catsTo.includes(c));
  if (!cat) throw new Error(`Cannot convert ${from} (${catsFrom.join("/")}) to ${to} (${catsTo.join("/")})`);
  if (cat === "temperature") {
    const f = normalize(from).toUpperCase();
    const t = normalize(to).toUpperCase();
    let c = value;
    if (f === "F") c = ((value - 32) * 5) / 9;
    if (f === "K") c = value - 273.15;
    let out = c;
    if (t === "F") out = (c * 9) / 5 + 32;
    if (t === "K") out = c + 273.15;
    return { value: out, category: cat };
  }
  return { value: (value * factor(cat, from)) / factor(cat, to), category: cat };
}

export const round = (v: number, d = 3): number => {
  if (!Number.isFinite(v)) return v;
  const p = 10 ** d;
  return Math.round(v * p) / p;
};
