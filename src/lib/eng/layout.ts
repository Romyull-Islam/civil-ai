/**
 * Deterministic space planning: arranges rooms on a plot so the language model never has to compute coordinates.
 * Row-based packing with a central circulation strip, wall thickness handling, door/window assignment,
 * and NBC 2016 (Part 3/4) minimum-size checks. Units: mm internally; inputs in metres.
 */
import type { Room } from "@/lib/drawing/templates";

export interface RoomRequest {
  name: string;
  /** desired area m² (used if width/length not given) */
  area?: number;
  width?: number; // m
  length?: number; // m
  /** habitable | kitchen | bath | wc | store | garage | other — drives minimum-size checks and window placement */
  kind?: "habitable" | "kitchen" | "bath" | "wc" | "store" | "garage" | "other";
}

export interface LayoutInput {
  plotWidth: number; // m (x)
  plotDepth: number; // m (y)
  rooms: RoomRequest[];
  setback?: { front?: number; rear?: number; side?: number }; // m
  wallThickness?: number; // mm, default 230
  corridorWidth?: number; // m, default 1.2 (0 for none)
  entrySide?: "S" | "N" | "E" | "W";
}

export interface LayoutResult {
  rooms: Room[]; // for draw_floor_plan (mm)
  buildable: { x: number; y: number; width: number; depth: number }; // m
  builtUpArea: number; // m² (outer)
  carpetArea: number; // m²
  coveragePercent: number;
  far: number;
  checks: { name: string; ok: boolean; detail: string }[];
  notes: string[];
}

const NBC_MIN: Record<NonNullable<RoomRequest["kind"]>, { area: number; width: number; label: string }> = {
  habitable: { area: 9.5, width: 2.4, label: "NBC 2016 Part 3 cl. 12.2: habitable room ≥ 9.5 m², min width 2.4 m" },
  kitchen: { area: 5.0, width: 1.8, label: "NBC 2016: kitchen ≥ 5.0 m² (4.5 m² with separate dining), min width 1.8 m" },
  bath: { area: 1.8, width: 1.2, label: "NBC 2016: bathroom ≥ 1.8 m², min width 1.2 m" },
  wc: { area: 1.1, width: 0.9, label: "NBC 2016: WC ≥ 1.1 m², min width 0.9 m" },
  store: { area: 3.0, width: 1.5, label: "NBC 2016: store ≥ 3.0 m²" },
  garage: { area: 13.5, width: 3.0, label: "NBC 2016: garage ≥ 3.0 × 4.5 m" },
  other: { area: 0, width: 0, label: "" },
};

function guessKind(name: string): NonNullable<RoomRequest["kind"]> {
  const n = name.toLowerCase();
  if (/bath|toilet|washroom/.test(n)) return "bath";
  if (/\bwc\b|w\.c/.test(n)) return "wc";
  if (/kitchen/.test(n)) return "kitchen";
  if (/store|utility|pantry/.test(n)) return "store";
  if (/garage|car/.test(n)) return "garage";
  if (/bed|living|dining|drawing|study|hall|lounge|master|guest|office/.test(n)) return "habitable";
  return "other";
}

/** Resolve each request to width × length in metres. */
function dims(r: RoomRequest): { w: number; l: number } {
  if (r.width && r.length) return { w: r.width, l: r.length };
  const minArea = NBC_MIN[r.kind ?? guessKind(r.name)].area;
  const area = r.area ?? (r.width ? r.width * r.width * 1.2 : minArea > 0 ? minArea * 1.3 : 9.5);
  if (r.width) return { w: r.width, l: area / r.width };
  if (r.length) return { w: area / r.length, l: r.length };
  const w = Math.sqrt(area / 1.15); // slightly rectangular
  return { w, l: area / w };
}

export function planLayout(inp: LayoutInput): LayoutResult {
  const t = (inp.wallThickness ?? 230) / 1000; // m
  const sb = { front: inp.setback?.front ?? 0, rear: inp.setback?.rear ?? 0, side: inp.setback?.side ?? 0 };
  const buildable = { x: sb.side, y: sb.front, width: inp.plotWidth - 2 * sb.side, depth: inp.plotDepth - sb.front - sb.rear };
  const corridor = inp.corridorWidth ?? 1.2;
  const notes: string[] = [];
  const checks: LayoutResult["checks"] = [];
  if (buildable.width <= 3 || buildable.depth <= 3) throw new Error("Buildable area after setbacks is too small");

  const reqs = inp.rooms.map((r) => ({ ...r, kind: r.kind ?? guessKind(r.name), ...dims(r) }));
  // Order: living/kitchen first (near entry), bedrooms, then wet areas grouped.
  const order = (k: string) => (/living|hall|drawing/i.test(k) ? 0 : /kitchen|dining/i.test(k) ? 1 : /bed/i.test(k) ? 2 : /store/i.test(k) ? 3 : 4);
  reqs.sort((a, b) => order(a.name) - order(b.name));

  // Two bands (front and rear) separated by a corridor; rooms fill each band left→right, clamped to buildable width by scaling depth.
  const innerW = buildable.width - t; // usable interior width across the band (outer walls each side ~t/2)
  const bandDepthMax = (buildable.depth - corridor - 3 * t) / 2; // outer walls + corridor walls
  const bands: { rooms: typeof reqs; used: number }[] = [{ rooms: [], used: 0 }, { rooms: [], used: 0 }];
  for (const r of reqs) {
    // choose band with less used width; if room too long for band depth, rotate it
    const band = bands[0].used <= bands[1].used ? 0 : 1;
    if (r.l > bandDepthMax && r.w <= bandDepthMax) { const tmp = r.w; r.w = r.l; r.l = tmp; }
    if (r.l > bandDepthMax) { notes.push(`${r.name}: depth reduced from ${r.l.toFixed(2)} m to fit the plot; width increased to keep area.`); const area = r.w * r.l; r.l = bandDepthMax; r.w = area / r.l; }
    bands[band].rooms.push(r); bands[band].used += r.w + t;
  }
  // If a band overflows the width, scale room widths proportionally in that band (keeping areas by growing depth where possible).
  for (const b of bands) {
    if (b.used > innerW && b.rooms.length) {
      const widths = b.rooms.reduce((sum, r) => sum + r.w, 0);
      const k = (innerW - b.rooms.length * t) / widths;
      for (const r of b.rooms) { const area = r.w * r.l; r.w *= k; r.l = Math.min(bandDepthMax, area / r.w); }
      b.used = b.rooms.reduce((s, r) => s + r.w + t, 0);
      notes.push("Rooms in one band were narrowed to fit the plot width; check minimum widths below.");
    }
  }
  const bandDepth = (i: number) => Math.max(0, ...bands[i].rooms.map((r) => r.l));
  // Stretch every room to its band depth so each band forms a clean rectangle (rooms only grow, never shrink).
  for (const b of bands) { const d = Math.max(0, ...b.rooms.map((r) => r.l)); for (const r of b.rooms) r.l = d; }
  const entryS = (inp.entrySide ?? "S") === "S";
  const rooms: Room[] = [];
  let y0 = buildable.y + t; // front band interior start (y up = towards rear)
  const frontBand = entryS ? 0 : 1;
  let first = true;
  for (const i of [frontBand, 1 - frontBand]) {
    let x = buildable.x + t;
    for (const r of bands[i].rooms) {
      const toCorridor: Room["door"] = i === frontBand ? "N" : "S"; // door towards corridor
      const outer: Room["window"] = i === frontBand ? "S" : "N"; // window on outer wall
      const doors: NonNullable<Room["doors"]> = corridor > 0 ? [toCorridor] : [];
      if (first) { doors.push(outer); first = false; } // main entrance on the front wall of the first room (living)
      rooms.push({ name: r.name, x: Math.round(x * 1000), y: Math.round(y0 * 1000), width: Math.round(r.w * 1000), length: Math.round(r.l * 1000), doors, windows: r.kind === "wc" ? [] : [outer] });
      x += r.w + t;
    }
    if (i === frontBand && corridor > 0) {
      const cy = y0 + bandDepth(i) + t;
      rooms.push({ name: "Passage", x: Math.round((buildable.x + t) * 1000), y: Math.round(cy * 1000), width: Math.round((Math.max(bands[0].used, bands[1].used) - t) * 1000), length: Math.round(corridor * 1000), open: true });
    }
    y0 += bandDepth(i) + t + corridor; // next band beyond the corridor
  }
  const outerDepth = bandDepth(frontBand) + bandDepth(1 - frontBand) + corridor + 3 * t;
  const outerWidth = Math.max(bands[0].used, bands[1].used) + t;
  const builtUp = outerWidth * outerDepth;
  const carpet = rooms.filter((r) => !r.open).reduce((s, r) => s + (r.width * r.length) / 1e6, 0);
  const plot = inp.plotWidth * inp.plotDepth;
  checks.push({ name: "Fits inside buildable area", ok: outerWidth <= buildable.width + 1e-6 && outerDepth <= buildable.depth + 1e-6, detail: `${outerWidth.toFixed(2)} × ${outerDepth.toFixed(2)} m footprint vs ${buildable.width.toFixed(2)} × ${buildable.depth.toFixed(2)} m buildable` });
  for (const r of reqs) {
    const m = NBC_MIN[r.kind];
    if (!m.area) continue;
    const area = r.w * r.l;
    checks.push({ name: `${r.name}: ${m.label}`, ok: area >= m.area - 1e-6 && Math.min(r.w, r.l) >= m.width - 1e-6, detail: `${r.w.toFixed(2)} × ${r.l.toFixed(2)} m = ${area.toFixed(1)} m²` });
  }
  notes.push(`Plot ${inp.plotWidth} × ${inp.plotDepth} m = ${plot.toFixed(1)} m²; setbacks front ${sb.front} / rear ${sb.rear} / side ${sb.side} m. Coverage and FAR limits depend on the local bye-laws — verify with the municipality.`);
  return { rooms, buildable, builtUpArea: builtUp, carpetArea: carpet, coveragePercent: (100 * builtUp) / plot, far: builtUp / plot, checks, notes };
}

/** Plot statistics: coverage, FAR/FSI, allowed built-up. */
export function plotStats(plotArea: number, floors: number, footprint: number, maxCoveragePercent?: number, maxFAR?: number) {
  const builtUp = footprint * floors;
  return {
    plotArea, footprint, floors, builtUp,
    coveragePercent: (100 * footprint) / plotArea,
    far: builtUp / plotArea,
    allowedFootprint: maxCoveragePercent !== undefined ? (plotArea * maxCoveragePercent) / 100 : undefined,
    allowedBuiltUp: maxFAR !== undefined ? plotArea * maxFAR : undefined,
    coverageOk: maxCoveragePercent === undefined ? undefined : (100 * footprint) / plotArea <= maxCoveragePercent,
    farOk: maxFAR === undefined ? undefined : builtUp / plotArea <= maxFAR,
  };
}

// ---------------------------------------------------------------------------------------------
// Building planner: high-level programme → per-floor room lists → plan_layout per floor.
// ---------------------------------------------------------------------------------------------

export type BuildingType = "single_family" | "duplex" | "apartment" | "shop_house" | "commercial" | "office";
export type Side = "N" | "S" | "E" | "W";

export interface BuildingInput {
  plot: { shape: "rectangular" | "square" | "polygon"; width?: number; depth?: number; points?: [number, number][] }; // m
  frontSide?: Side; // road / entrance side (default S)
  setback?: { front?: number; rear?: number; side?: number }; // m; defaults by plot size when omitted
  buildingType: BuildingType;
  storeys: number;
  bedrooms?: number; // per dwelling unit
  bathrooms?: number;
  unitsPerFloor?: number; // apartments
  shops?: number; // shop_house / commercial ground floor
  garage?: boolean;
  dining?: boolean;
  study?: boolean;
  store?: boolean;
  windowsPerRoom?: 1 | 2;
  wallThickness?: number; // mm
  corridorWidth?: number; // m
  maxCoveragePercent?: number;
  maxFAR?: number;
}

export interface FloorPlanResult { floor: string; layout: LayoutResult; rooms: RoomRequest[] }

function defaultSetback(area: number) {
  if (area <= 100) return { front: 1.2, rear: 1.0, side: 0.9 };
  if (area <= 200) return { front: 1.5, rear: 1.5, side: 1.0 };
  if (area <= 500) return { front: 3.0, rear: 2.0, side: 1.5 };
  return { front: 4.5, rear: 3.0, side: 3.0 };
}

/** Bounding rectangle of a polygon plot (irregular plots are planned on their largest axis-aligned box, flagged in notes). */
function plotRect(p: BuildingInput["plot"]): { width: number; depth: number; note?: string } {
  if (p.shape === "polygon" && p.points?.length) {
    const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
    // shrink to ~85% to stay inside typical irregular boundaries
    return { width: w * 0.85, depth: d * 0.85, note: `Irregular plot (${p.points.length} corners): planned on an inscribed ${(w * 0.85).toFixed(1)} × ${(d * 0.85).toFixed(1)} m rectangle — verify against the actual boundary.` };
  }
  if (p.shape === "square") { const s = p.width ?? p.depth ?? 10; return { width: s, depth: s }; }
  return { width: p.width ?? 10, depth: p.depth ?? 12 };
}

/** Room programme for one dwelling unit. `part`: "all" (single storey), "ground" (living areas) or "upper" (sleeping areas). */
function dwellingProgramme(inp: BuildingInput, part: "all" | "ground" | "upper", compact = false): RoomRequest[] {
  const beds = inp.bedrooms ?? 2, baths = inp.bathrooms ?? Math.max(1, Math.ceil(beds / 2));
  const k = compact ? 0.8 : 1;
  const living: RoomRequest[] = [{ name: "Living", area: 20 * k, kind: "habitable" }, { name: "Kitchen", area: 8 * k, kind: "kitchen" }];
  if (inp.dining) living.push({ name: "Dining", area: 12 * k, kind: "habitable" });
  if (inp.store) living.push({ name: "Store", area: 3, kind: "store" });
  const sleeping: RoomRequest[] = [];
  for (let i = 1; i <= beds; i++) sleeping.push({ name: i === 1 ? "Master bedroom" : `Bedroom ${i}`, area: (i === 1 ? 16 : 12) * k, kind: "habitable" });
  if (inp.study) sleeping.push({ name: "Study", area: 9.5, kind: "habitable" });
  const bathList = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ name: n + offset > 1 ? `Bath ${i + 1 + offset}` : "Bath", area: 3.5, kind: "bath" as const }));
  if (part === "all") return [...living, ...sleeping, ...bathList(baths)];
  if (part === "ground") return [...living, { name: "Guest bath", area: 2.5, kind: "bath" }];
  return [...sleeping, ...bathList(Math.max(1, baths - (baths > 1 ? 1 : 0)))];
}

export function planBuilding(inp: BuildingInput): { floors: FloorPlanResult[]; summary: Record<string, unknown>; checks: LayoutResult["checks"]; notes: string[] } {
  const rect = plotRect(inp.plot);
  const plotArea = rect.width * rect.depth;
  const sb = { ...defaultSetback(plotArea), ...(inp.setback ?? {}) };
  const notes: string[] = [];
  if (rect.note) notes.push(rect.note);
  const storeys = Math.max(1, Math.min(10, Math.round(inp.storeys)));
  const floors: FloorPlanResult[] = [];
  const front = inp.frontSide ?? "S";
  const multi = storeys > 1;
  for (let f = 0; f < storeys; f++) {
    const ground = f === 0;
    let rooms: RoomRequest[] = [];
    const label = ground ? "Ground floor" : `Floor ${f}`;
    switch (inp.buildingType) {
      case "single_family":
        rooms = dwellingProgramme(inp, storeys === 1 ? "all" : ground ? "ground" : "upper");
        break;
      case "duplex": // two units side by side; each unit has living areas on the ground floor and bedrooms above
        rooms = [1, 2].flatMap((u) => dwellingProgramme(inp, storeys === 1 ? "all" : ground ? "ground" : "upper", true).map((r) => ({ ...r, name: `U${u} ${r.name}` })));
        break;
      case "apartment": {
        const units = Math.max(1, inp.unitsPerFloor ?? 2);
        rooms = Array.from({ length: units }, (_, u) => dwellingProgramme(inp, "all", units > 2).map((r) => ({ ...r, name: `Flat ${u + 1} ${r.name}` }))).flat();
        break;
      }
      case "shop_house":
        rooms = ground ? Array.from({ length: Math.max(1, inp.shops ?? 2) }, (_, i) => ({ name: `Shop ${i + 1}`, area: 20, kind: "other" as const })) : dwellingProgramme(inp, "all");
        break;
      case "commercial":
        rooms = Array.from({ length: Math.max(1, inp.shops ?? 4) }, (_, i) => ({ name: `Shop ${i + 1}`, area: 25, kind: "other" as const }));
        rooms.push({ name: "Toilets", area: 6, kind: "bath" });
        break;
      case "office":
        rooms = [{ name: "Reception", area: 15, kind: "other" }, { name: "Open office", area: 40, kind: "other" }, { name: "Cabin 1", area: 12, kind: "other" }, { name: "Cabin 2", area: 12, kind: "other" }, { name: "Meeting", area: 16, kind: "other" }, { name: "Pantry", area: 6, kind: "kitchen" }, { name: "Toilets", area: 6, kind: "bath" }];
        break;
    }
    if (ground && inp.garage) rooms.unshift({ name: "Garage", width: 3.2, length: 5.0, kind: "garage" });
    if (multi) rooms.push({ name: "Stair", area: 6, kind: "other" });
    const layout = planLayout({ plotWidth: rect.width, plotDepth: rect.depth, rooms, setback: sb, wallThickness: inp.wallThickness, corridorWidth: inp.corridorWidth, entrySide: front });
    if ((inp.windowsPerRoom ?? 1) === 2) for (const r of layout.rooms) if (!r.open && r.windows?.length) r.windows = [...r.windows, r.windows[0] === "S" || r.windows[0] === "N" ? "E" : "N"];
    floors.push({ floor: label, layout, rooms });
  }
  const footprint = Math.max(...floors.map((f) => f.layout.builtUpArea));
  const stats = plotStats(plotArea, storeys, footprint, inp.maxCoveragePercent, inp.maxFAR);
  const checks: LayoutResult["checks"] = floors.flatMap((f) => f.layout.checks.map((c) => ({ ...c, name: `${f.floor} — ${c.name}` })));
  if (inp.maxCoveragePercent !== undefined) checks.push({ name: "Ground coverage limit", ok: !!stats.coverageOk, detail: `${stats.coveragePercent.toFixed(1)}% vs ${inp.maxCoveragePercent}% allowed` });
  if (inp.maxFAR !== undefined) checks.push({ name: "FAR limit", ok: !!stats.farOk, detail: `${stats.far.toFixed(2)} vs ${inp.maxFAR} allowed` });
  notes.push(`Setbacks used: front ${sb.front} m, rear ${sb.rear} m, side ${sb.side} m (${inp.setback ? "as given" : "defaults by plot size — confirm with local bye-laws"}). Front/road side: ${front}.`);
  notes.push(...floors[0].layout.notes.filter((n) => !/^Plot/.test(n)));
  return { floors, summary: { plotArea, footprint, storeys, builtUp: stats.builtUp, coveragePercent: stats.coveragePercent, far: stats.far, carpetPerFloor: floors.map((f) => ({ floor: f.floor, carpet: f.layout.carpetArea, rooms: f.layout.rooms.filter((r) => !r.open).length })) }, checks, notes };
}
