/**
 * Subdivision lot layout (yield study), the first step land-development software automates:
 * a tract of any shape (plot.ts) with an existing road along one edge is cut into rows of lots parallel to that road.
 * Row 1 fronts the existing road; behind it, pairs of back-to-back rows front new internal streets
 * (existing road | lots | lots | street | lots | lots | street …). Internal streets connect to an access street running
 * back from the existing road along the left or right side (or run through to the side boundaries: "none").
 * Lots share each row equally (uniform frontage ≥ the minimum); open space is taken from the rows farthest from the road.
 *
 * Checks: minimum lot width, depth and area; block length; share of land in streets; USA fire access
 * (IFC 2024 503.2.1: access roads ≥ 20 ft (6.1 m) unobstructed width; 503.2.5: dead ends longer than 150 ft (45.72 m)
 * need an approved turnaround). Zoning (lot size, setbacks, coverage) is a local input.
 * Bangladesh (Private Residential Land Development Rules 2004, amended 2012/2015), as quoted by RAJUK's DAP project
 * manager (S. N. Haque, BIP World Town Planning Day 2018) and the Journal of the Bangladesh Institute of Planners
 * (M. Shamsuzzaman, 2014): internal roads primary 80 ft, secondary 60 ft, tertiary 40 ft, access 25 ft (2012
 * amendment); commercial land ≥ 1.7%; gross residential density ≤ 350 persons/acre; community facilities including
 * residential access roads 20 acres per 20,000 people (one row of the rules' schedule). Units: m internally.
 */
import { plotGeometry, type PlotInput, type Pt } from "./plot";

export interface SubdivisionInput {
  tract: PlotInput;
  units?: "m" | "ft"; // lot, street and setback dimensions (the tract has its own units)
  lotWidth: number; // minimum frontage
  lotDepth: number;
  minLotArea?: number; // m² (ft² with units ft)
  streetWidth: number; // right-of-way of the new streets
  pavementWidth?: number; // carriageway inside the ROW (fire access check, quantities)
  accessStreet?: "left" | "right" | "none";
  openSpacePercent?: number;
  setbacks?: { front: number; rear: number; side: number };
  maxCoveragePercent?: number;
  maxBlockLength?: number;
  country?: "US" | "BD" | "other";
  /** Bangladesh private housing project rules (default on for country BD) */
  bdProjectRules?: boolean;
  /** people per plot (flats per plot × household size), for the density check */
  personsPerLot?: number;
  /** land for shops/markets, taken from the lots along the existing road (Bangladesh rules: at least 1.7%) */
  commercialPercent?: number;
}
export interface Lot { no: number; row: number; frontsOn: string; x: number; y: number; width: number; depth: number; area: number; openSpace: boolean; commercial?: boolean; buildable?: { width: number; depth: number; area: number } }
export interface StreetStrip { name: string; x: number; y: number; width: number; length: number; vertical: boolean }

const FT = 0.3048;
/** x-intervals where the horizontal line y lies inside the polygon. */
function lineIntervals(poly: Pt[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
const intersect = (a: [number, number][], b: [number, number][]) => a.flatMap(([a0, a1]) => b.flatMap(([b0, b1]) => { const lo = Math.max(a0, b0), hi = Math.min(a1, b1); return hi - lo > 1e-6 ? [[lo, hi] as [number, number]] : []; }));
const subtract = (a: [number, number][], [c0, c1]: [number, number]) => a.flatMap(([a0, a1]): [number, number][] => (c1 <= a0 || c0 >= a1 ? [[a0, a1]] : ([[a0, Math.min(a1, c0)], [Math.max(a0, c1), a1]] as [number, number][]).filter(([p, q]) => q - p > 1e-6)));
/** Where a horizontal band [ya, yb] lies fully inside the polygon. */
function bandIntervals(poly: Pt[], ya: number, yb: number): [number, number][] {
  const ys = new Set<number>([ya + 1e-6, yb - 1e-6]);
  for (let k = 1; k < 24; k++) ys.add(ya + ((yb - ya) * k) / 24);
  for (const [, y] of poly) if (y > ya && y < yb) { ys.add(y - 1e-6); ys.add(y + 1e-6); }
  let cur: [number, number][] | null = null;
  for (const y of ys) { const iv = lineIntervals(poly, y); cur = cur === null ? iv : intersect(cur, iv); if (!cur.length) break; }
  return cur ?? [];
}

export function subdivide(inp: SubdivisionInput) {
  const k = inp.units === "ft" ? FT : 1;
  const g = plotGeometry(inp.tract);
  const poly = g.points;
  const D = inp.lotDepth * k, W = inp.streetWidth * k;
  let w = inp.lotWidth * k;
  const Amin = (inp.minLotArea ?? 0) * k * k;
  const notes: string[] = [...g.notes];
  if (!(D > 0 && W > 0 && w > 0)) throw new Error("Lot width, lot depth and street width must be positive");
  if (Amin > w * D) { w = Amin / D; notes.push(`Minimum lot area governs the frontage: ${(Amin / (k * k)).toFixed(0)} ${inp.units === "ft" ? "sq ft" : "m²"} / depth = ${(w / k).toFixed(2)} ${inp.units ?? "m"} per lot.`); }
  const Ymax = Math.max(...poly.map((p) => p[1]));
  // Rows and streets, bottom (existing road) upwards
  const bands: { y: number; kind: "row" | "street"; frontsOn: string }[] = [{ y: 0, kind: "row", frontsOn: "existing road" }];
  let y = D, n = 0;
  while (y + 2 * D + W <= Ymax + 1e-9) {
    n++;
    bands.push({ y, kind: "row", frontsOn: `Street ${n}` }, { y: y + D, kind: "street", frontsOn: `Street ${n}` }, { y: y + D + W, kind: "row", frontsOn: `Street ${n}` });
    y += 2 * D + W;
  }
  if (y + W + D <= Ymax + 1e-9) { n++; bands.push({ y, kind: "street", frontsOn: `Street ${n}` }, { y: y + W, kind: "row", frontsOn: `Street ${n}` }); y += W + D; }
  const topStreet = Math.max(0, ...bands.filter((b) => b.kind === "street").map((b) => b.y + W));
  // Access street from the existing road to the last internal street
  const access = n > 0 ? inp.accessStreet ?? "left" : "none";
  let spine: [number, number] | null = null;
  const streets: StreetStrip[] = [];
  if (access !== "none") {
    const full = bandIntervals(poly, 0, topStreet);
    if (!full.length) throw new Error("The tract is too irregular for a straight access street; try accessStreet none or the other side");
    spine = access === "left" ? [full[0][0], full[0][0] + W] : [full[full.length - 1][1] - W, full[full.length - 1][1]];
    streets.push({ name: "Access street", x: spine[0], y: 0, width: W, length: topStreet, vertical: true });
  }
  const lots: Lot[] = [];
  const blockLengths: number[] = [];
  let row = 0;
  for (const b of bands) {
    const depth = b.kind === "row" ? D : W;
    let iv = bandIntervals(poly, b.y, b.y + depth);
    if (spine) iv = subtract(iv, spine);
    if (b.kind === "street") { for (const [x0, x1] of iv) streets.push({ name: b.frontsOn, x: x0, y: b.y, width: W, length: x1 - x0, vertical: false }); continue; }
    row++;
    for (const [x0, x1] of iv) {
      const len = x1 - x0, count = Math.floor(len / w + 1e-9);
      if (count < 1) continue;
      blockLengths.push(len);
      const lw = len / count;
      for (let i = 0; i < count; i++) lots.push({ no: lots.length + 1, row, frontsOn: b.frontsOn, x: x0 + i * lw, y: b.y, width: lw, depth: D, area: lw * D, openSpace: false });
    }
  }
  if (!lots.length) throw new Error("No lot fits: the tract is smaller than one lot, or the lot and street sizes are too large");
  const tractArea = g.area;
  // Open space from the farthest rows
  const osTarget = ((inp.openSpacePercent ?? 0) / 100) * tractArea;
  let os = 0;
  for (const lot of [...lots].reverse()) { if (os >= osTarget - 1e-9) break; lot.openSpace = true; os += lot.area; }
  // Commercial land from the lots along the existing road
  const bd = inp.bdProjectRules ?? inp.country === "BD";
  const comPct = inp.commercialPercent ?? (bd ? 1.7 : 0);
  let com = 0;
  for (const lot of lots.filter((l) => l.row === 1 && !l.openSpace)) { if (com >= (comPct / 100) * tractArea - 1e-9) break; lot.commercial = true; com += lot.area; }
  // Buildable envelope with setbacks
  if (inp.setbacks) {
    const sb = { front: inp.setbacks.front * k, rear: inp.setbacks.rear * k, side: inp.setbacks.side * k };
    for (const lot of lots) { const bw = lot.width - 2 * sb.side, bd = lot.depth - sb.front - sb.rear; let area = Math.max(0, bw) * Math.max(0, bd); if (inp.maxCoveragePercent) area = Math.min(area, (lot.area * inp.maxCoveragePercent) / 100); lot.buildable = { width: Math.max(0, bw), depth: Math.max(0, bd), area }; }
  }
  const saleLots = lots.filter((l) => !l.openSpace && !l.commercial);
  const lotArea = saleLots.reduce((s, l) => s + l.area, 0);
  const streetArea = streets.reduce((s, st) => s + st.width * st.length, 0);
  const remnant = Math.max(0, tractArea - lotArea - streetArea - os - com);
  const hectares = tractArea / 10000, acres = tractArea / 4046.8564224;
  const internalLength = streets.reduce((s, st) => s + st.length, 0);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const u = inp.units === "ft" ? "ft" : "m", ua = inp.units === "ft" ? "sq ft" : "m²";
  const L = (m: number) => `${(m / k).toFixed(1)} ${u}`, A = (m2: number) => `${(m2 / (k * k)).toFixed(0)} ${ua}`;
  const minW = Math.min(...saleLots.map((l) => l.width));
  checks.push({ name: "Minimum lot frontage", ok: minW >= inp.lotWidth * k - 1e-6, detail: `narrowest lot ${L(minW)} vs ${L(inp.lotWidth * k)}` });
  if (Amin) checks.push({ name: "Minimum lot area", ok: Math.min(...saleLots.map((l) => l.area)) >= Amin - 1e-6, detail: `smallest lot ${A(Math.min(...saleLots.map((l) => l.area)))} vs ${A(Amin)}` });
  if (inp.maxBlockLength) checks.push({ name: "Block length", ok: Math.max(...blockLengths) <= inp.maxBlockLength * k + 1e-6, detail: `longest row of lots ${L(Math.max(...blockLengths))} vs ${L(inp.maxBlockLength * k)} allowed` });
  if (inp.openSpacePercent) checks.push({ name: "Open space", ok: os >= osTarget - 1e-6, detail: `${A(os)} = ${((100 * os) / tractArea).toFixed(1)}% vs ${inp.openSpacePercent}% required` });
  if (inp.country === "US") {
    const pave = (inp.pavementWidth ?? inp.streetWidth) * k;
    checks.push({ name: "Fire access width (IFC 503.2.1)", ok: pave >= 20 * FT - 1e-6, detail: `street ${inp.pavementWidth ? "pavement" : "width"} ${(pave / FT).toFixed(1)} ft vs 20 ft unobstructed` });
    if (access !== "none") {
      const longest = Math.max(0, ...streets.filter((s) => !s.vertical).map((s) => s.length));
      checks.push({ name: "Dead-end length (IFC 503.2.5)", ok: longest <= 150 * FT + 1e-6, detail: `internal streets end at the far boundary: ${(longest / FT).toFixed(0)} ft vs 150 ft without a turnaround${longest > 150 * FT ? "; add an approved turnaround (IFC Appendix D where adopted) or connect the far end" : ""}` });
    }
  }
  if (bd) {
    const ftm = (f: number) => f * FT;
    const internal = streets.filter((s) => !s.vertical);
    checks.push({ name: "Access roads ≥ 25 ft (PRLDR 2004, 2012 amendment)", ok: W >= ftm(25) - 1e-6, detail: `new streets ${(W / FT).toFixed(1)} ft (${W.toFixed(2)} m) vs access road 25 ft (7.62 m)` });
    if (access !== "none" && internal.length >= 2) checks.push({ name: "Collector ≥ 40 ft (tertiary road)", ok: W >= ftm(40) - 1e-6, detail: `the access street serves ${internal.length} streets: ${(W / FT).toFixed(1)} ft vs tertiary road 40 ft (12.19 m); larger projects also need secondary (60 ft) and primary (80 ft) roads` });
    checks.push({ name: "Commercial land ≥ 1.7%", ok: com >= 0.017 * tractArea - 1e-6, detail: `${((100 * com) / tractArea).toFixed(2)}% reserved along the existing road` });
    if (inp.personsPerLot) {
      const persons = saleLots.length * inp.personsPerLot;
      checks.push({ name: "Gross density ≤ 350 persons/acre", ok: persons / acres <= 350 + 1e-9, detail: `${persons} persons on ${acres.toFixed(2)} acres = ${(persons / acres).toFixed(0)} persons/acre` });
      const need = persons * 0.001; // 20 acres per 20,000 people
      const have = (streetArea + os) / 4046.8564224;
      notes.push(`Community facilities: the rules' schedule gives 20 acres for 20,000 people (education, health, community, recreation, commercial and residential access roads). Pro rata for ${persons} people that is ${need.toFixed(2)} acres; this layout has ${have.toFixed(2)} acres of streets and open space. The schedule's values for other population sizes must be checked in the rules.`);
    } else notes.push("Give persons per plot (flats per plot × household size) to check the 350 persons/acre density limit.");
    notes.push("Bangladesh rule values are as quoted by RAJUK's DAP project manager (BIP 2018) and the Journal of the Bangladesh Institute of Planners (2014); confirm against the gazette of the Private Residential Land Development Rules 2004 (amended 2012, 2015) and the approving authority.");
  }
  if (access === "none" && n > 0) notes.push("Internal streets run to both side boundaries: they must connect to roads there (or add an access street).");
  if (inp.country === "BD") notes.push("Lot sizes are also given in katha (1 katha = 66.89 m²).");
  notes.push("Yield study: final lot lines follow a boundary survey, road geometry (curves, intersections, turnarounds), drainage and utility easements.");
  return {
    units: u, tract: { area: tractArea, hectares, acres, perimeter: g.perimeter, points: poly },
    lots, streets, openSpaceArea: os, commercialArea: com, lotArea, streetArea, remnantArea: remnant,
    lotCount: saleLots.length, rows: row, internalStreets: n, streetLength: internalLength,
    shares: { lots: (100 * lotArea) / tractArea, streets: (100 * streetArea) / tractArea, openSpace: (100 * os) / tractArea, commercial: (100 * com) / tractArea, remnant: (100 * remnant) / tractArea },
    density: { perHectare: saleLots.length / hectares, perAcre: saleLots.length / acres },
    averageLot: lotArea / saleLots.length, checks, notes,
  };
}
