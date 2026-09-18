/** Parametric drawing generators. All dimensions in mm. Origin bottom-left. */
import { Drawing, Entity, DEFAULT_LAYERS } from "./types";

function spread(count: number, from: number, to: number): number[] {
  if (count <= 1) return [(from + to) / 2];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(from + ((to - from) * i) / (count - 1));
  return out;
}

export interface BeamSectionParams {
  b: number; D: number; cover?: number;
  bottomBars: { count: number; dia: number };
  topBars?: { count: number; dia: number };
  stirrup?: { dia: number; spacing: number };
  title?: string;
  notes?: string[];
}

export function beamSection(p: BeamSectionParams): Drawing {
  const cover = p.cover ?? 25;
  const st = p.stirrup ?? { dia: 8, spacing: 150 };
  const E: Entity[] = [];
  E.push({ type: "polyline", layer: "OUTLINE", closed: true, points: [[0, 0], [p.b, 0], [p.b, p.D], [0, p.D]] });
  // stirrup rectangle (rounded corners approximated by polyline)
  const c = cover;
  E.push({ type: "polyline", layer: "STIRRUP", closed: true, points: [[c, c], [p.b - c, c], [p.b - c, p.D - c], [c, p.D - c]] });
  // hook
  E.push({ type: "line", layer: "STIRRUP", x1: c, y1: p.D - c, x2: c + 8 * st.dia * 0.7, y2: p.D - c - 8 * st.dia * 0.7 });
  const inner = c + st.dia;
  const bb = p.bottomBars;
  const y0 = inner + bb.dia / 2;
  for (const x of spread(bb.count, inner + bb.dia / 2, p.b - inner - bb.dia / 2)) E.push({ type: "circle", layer: "REBAR", cx: x, cy: y0, r: bb.dia / 2 });
  const tb = p.topBars ?? { count: 2, dia: 12 };
  const y1 = p.D - inner - tb.dia / 2;
  for (const x of spread(tb.count, inner + tb.dia / 2, p.b - inner - tb.dia / 2)) E.push({ type: "circle", layer: "REBAR", cx: x, cy: y1, r: tb.dia / 2 });
  // dims
  E.push({ type: "dimension", layer: "DIM", x1: 0, y1: 0, x2: p.b, y2: 0, offset: -Math.max(40, p.D * 0.12) });
  E.push({ type: "dimension", layer: "DIM", x1: p.b, y1: 0, x2: p.b, y2: p.D, offset: -Math.max(40, p.b * 0.15) });
  // labels
  const th = Math.max(8, p.b / 25);
  E.push({ type: "text", layer: "TEXT", x: p.b + Math.max(60, p.b * 0.25), y: y0, text: `${bb.count}-Ø${bb.dia} BOTTOM`, height: th });
  E.push({ type: "text", layer: "TEXT", x: p.b + Math.max(60, p.b * 0.25), y: y1, text: `${tb.count}-Ø${tb.dia} TOP`, height: th });
  E.push({ type: "text", layer: "TEXT", x: p.b + Math.max(60, p.b * 0.25), y: p.D / 2, text: `Ø${st.dia} STIRRUPS @ ${st.spacing} C/C`, height: th });
  E.push({ type: "text", layer: "TEXT", x: p.b / 2, y: -Math.max(40, p.D * 0.12) - th * 4, text: p.title ?? `BEAM SECTION ${p.b}x${p.D}`, height: th * 1.3, align: "center" });
  E.push({ type: "text", layer: "TEXT", x: p.b / 2, y: -Math.max(40, p.D * 0.12) - th * 6, text: `CLEAR COVER ${cover} mm`, height: th * 0.9, align: "center" });
  return { title: p.title ?? `Beam section ${p.b}×${p.D}`, units: "mm", layers: DEFAULT_LAYERS, entities: E, notes: p.notes };
}

export interface ColumnSectionParams { b: number; D: number; cover?: number; bars: { count: number; dia: number }; tie?: { dia: number; spacing: number }; title?: string }

export function columnSection(p: ColumnSectionParams): Drawing {
  const cover = p.cover ?? 40;
  const tie = p.tie ?? { dia: 8, spacing: 200 };
  const E: Entity[] = [];
  E.push({ type: "polyline", layer: "OUTLINE", closed: true, points: [[0, 0], [p.b, 0], [p.b, p.D], [0, p.D]] });
  E.push({ type: "polyline", layer: "STIRRUP", closed: true, points: [[cover, cover], [p.b - cover, cover], [p.b - cover, p.D - cover], [cover, p.D - cover]] });
  const inner = cover + tie.dia + p.bars.dia / 2;
  // distribute bars around perimeter
  const n = Math.max(4, p.bars.count);
  const perSideX = Math.ceil((n - 4) / 4) + 2; // approximate
  const perSideY = Math.floor((n - 4) / 4) + 2;
  const pts: [number, number][] = [];
  const xs = spread(perSideX, inner, p.b - inner);
  const ys = spread(perSideY, inner, p.D - inner);
  for (const x of xs) { pts.push([x, inner]); pts.push([x, p.D - inner]); }
  for (const y of ys.slice(1, -1)) { pts.push([inner, y]); pts.push([p.b - inner, y]); }
  const uniq = pts.filter((q, i) => pts.findIndex((r) => Math.abs(r[0] - q[0]) < 1e-6 && Math.abs(r[1] - q[1]) < 1e-6) === i).slice(0, n);
  for (const [x, y] of uniq) E.push({ type: "circle", layer: "REBAR", cx: x, cy: y, r: p.bars.dia / 2 });
  E.push({ type: "dimension", layer: "DIM", x1: 0, y1: 0, x2: p.b, y2: 0, offset: -Math.max(40, p.D * 0.15) });
  E.push({ type: "dimension", layer: "DIM", x1: p.b, y1: 0, x2: p.b, y2: p.D, offset: -Math.max(40, p.b * 0.15) });
  const th = Math.max(8, p.b / 25);
  E.push({ type: "text", layer: "TEXT", x: p.b + Math.max(60, p.b * 0.25), y: p.D * 0.6, text: `${uniq.length}-Ø${p.bars.dia} MAIN BARS`, height: th });
  E.push({ type: "text", layer: "TEXT", x: p.b + Math.max(60, p.b * 0.25), y: p.D * 0.4, text: `Ø${tie.dia} TIES @ ${tie.spacing} C/C`, height: th });
  E.push({ type: "text", layer: "TEXT", x: p.b / 2, y: -Math.max(40, p.D * 0.15) - th * 4, text: p.title ?? `COLUMN SECTION ${p.b}x${p.D}`, height: th * 1.3, align: "center" });
  return { title: p.title ?? `Column section ${p.b}×${p.D}`, units: "mm", layers: DEFAULT_LAYERS, entities: E };
}

export interface FootingParams { side: number; depth: number; columnB: number; columnD: number; bars: { dia: number; spacing: number }; cover?: number; title?: string }

export function footingDrawing(p: FootingParams): Drawing {
  const cover = p.cover ?? 50;
  const E: Entity[] = [];
  const S = p.side;
  // PLAN (bottom-left at 0,0)
  E.push({ type: "polyline", layer: "OUTLINE", closed: true, points: [[0, 0], [S, 0], [S, S], [0, S]] });
  const cx = (S - p.columnB) / 2, cy = (S - p.columnD) / 2;
  E.push({ type: "hatch", layer: "HATCH", pattern: "concrete", spacing: Math.max(20, p.columnB / 6), points: [[cx, cy], [cx + p.columnB, cy], [cx + p.columnB, cy + p.columnD], [cx, cy + p.columnD]] });
  // rebar in plan (show a few lines each way)
  const nBars = Math.floor((S - 2 * cover) / p.bars.spacing) + 1;
  for (let i = 0; i < nBars; i++) {
    const o = cover + i * p.bars.spacing;
    if (o > S - cover) break;
    E.push({ type: "line", layer: "REBAR", x1: cover, y1: o, x2: S - cover, y2: o });
    E.push({ type: "line", layer: "REBAR", x1: o, y1: cover, x2: o, y2: S - cover });
  }
  E.push({ type: "dimension", layer: "DIM", x1: 0, y1: 0, x2: S, y2: 0, offset: -S * 0.1 });
  E.push({ type: "dimension", layer: "DIM", x1: S, y1: 0, x2: S, y2: S, offset: -S * 0.1 });
  E.push({ type: "dimension", layer: "DIM", x1: cx, y1: S, x2: cx + p.columnB, y2: S, offset: S * 0.08 });
  const th = Math.max(20, S / 40);
  E.push({ type: "text", layer: "TEXT", x: S / 2, y: -S * 0.1 - th * 4, text: "PLAN", height: th * 1.2, align: "center" });
  // SECTION to the right
  const ox = S * 1.4;
  const D = p.depth;
  const colH = D * 1.2;
  E.push({ type: "polyline", layer: "OUTLINE", closed: true, points: [[ox, 0], [ox + S, 0], [ox + S, D], [ox, D]] });
  E.push({ type: "line", layer: "OUTLINE", x1: ox + cx, y1: D, x2: ox + cx, y2: D + colH });
  E.push({ type: "line", layer: "OUTLINE", x1: ox + cx + p.columnB, y1: D, x2: ox + cx + p.columnB, y2: D + colH });
  E.push({ type: "hatch", layer: "HATCH", pattern: "earth", spacing: Math.max(30, S / 25), points: [[ox - S * 0.15, 0], [ox, 0], [ox, D + colH * 0.5], [ox - S * 0.15, D + colH * 0.5]] });
  E.push({ type: "hatch", layer: "HATCH", pattern: "earth", spacing: Math.max(30, S / 25), points: [[ox + S, 0], [ox + S + S * 0.15, 0], [ox + S + S * 0.15, D + colH * 0.5], [ox + S, D + colH * 0.5]] });
  // bottom bars in section
  E.push({ type: "line", layer: "REBAR", x1: ox + cover, y1: cover, x2: ox + S - cover, y2: cover });
  E.push({ type: "line", layer: "REBAR", x1: ox + cover, y1: cover, x2: ox + cover, y2: cover + Math.min(150, D - 2 * cover) });
  E.push({ type: "line", layer: "REBAR", x1: ox + S - cover, y1: cover, x2: ox + S - cover, y2: cover + Math.min(150, D - 2 * cover) });
  for (let i = 0; i < nBars; i++) {
    const o = cover + i * p.bars.spacing;
    if (o > S - cover) break;
    E.push({ type: "circle", layer: "REBAR", cx: ox + o, cy: cover + p.bars.dia, r: p.bars.dia / 2 });
  }
  // column dowels
  E.push({ type: "line", layer: "REBAR", x1: ox + cx + cover, y1: cover + 20, x2: ox + cx + cover, y2: D + colH });
  E.push({ type: "line", layer: "REBAR", x1: ox + cx + p.columnB - cover, y1: cover + 20, x2: ox + cx + p.columnB - cover, y2: D + colH });
  E.push({ type: "dimension", layer: "DIM", x1: ox + S, y1: 0, x2: ox + S, y2: D, offset: -S * 0.12 });
  E.push({ type: "dimension", layer: "DIM", x1: ox, y1: 0, x2: ox + S, y2: 0, offset: -S * 0.1 });
  E.push({ type: "text", layer: "TEXT", x: ox + S / 2, y: -S * 0.1 - th * 4, text: "SECTION A-A", height: th * 1.2, align: "center" });
  E.push({ type: "text", layer: "TEXT", x: ox + S / 2, y: D + colH + th, text: `Ø${p.bars.dia} @ ${p.bars.spacing} C/C BOTH WAYS, COVER ${cover}`, height: th * 0.9, align: "center" });
  E.push({ type: "text", layer: "TEXT", x: ox / 2 + S * 0.7, y: D + colH + th * 4, text: p.title ?? `ISOLATED FOOTING ${S}x${S}x${D}`, height: th * 1.5, align: "center" });
  return { title: p.title ?? `Isolated footing ${S}×${S}×${D}`, units: "mm", layers: DEFAULT_LAYERS, entities: E };
}

export type Side = "N" | "S" | "E" | "W";
export interface Room { name: string; x: number; y: number; width: number; length: number; door?: Side; doors?: Side[]; window?: Side; windows?: Side[]; /** draw label only, no walls (e.g. passage) */ open?: boolean }
export interface FloorPlanParams { rooms: Room[]; wallThickness?: number; title?: string; showDimensions?: boolean }

/** Simple single-line floor plan: rooms as rectangles (interior dims), walls drawn around them with double lines. */
export function floorPlan(p: FloorPlanParams): Drawing {
  const t = p.wallThickness ?? 230;
  const E: Entity[] = [];
  let maxX = 0, maxY = 0;
  for (const r of p.rooms) {
    const x0 = r.x, y0 = r.y, x1 = r.x + r.width, y1 = r.y + r.length;
    maxX = Math.max(maxX, x1 + t); maxY = Math.max(maxY, y1 + t);
    // inner face and outer face (walls shared between rooms overlap; acceptable for a sketch)
    if (!r.open) {
      E.push({ type: "polyline", layer: "WALL", closed: true, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
      E.push({ type: "polyline", layer: "WALL", closed: true, points: [[x0 - t / 2, y0 - t / 2], [x1 + t / 2, y0 - t / 2], [x1 + t / 2, y1 + t / 2], [x0 - t / 2, y1 + t / 2]] });
    }
    const th = Math.min(250, Math.max(120, r.width / 12));
    E.push({ type: "text", layer: "TEXT", x: (x0 + x1) / 2, y: (y0 + y1) / 2 + th * 0.3, text: r.name.toUpperCase(), height: th, align: "center" });
    E.push({ type: "text", layer: "TEXT", x: (x0 + x1) / 2, y: (y0 + y1) / 2 - th * 1.4, text: `${(r.width / 1000).toFixed(2)} x ${(r.length / 1000).toFixed(2)} m`, height: th * 0.7, align: "center" });
    // doors: 900 wide opening with quarter-circle swing
    for (const side of [...(r.doors ?? []), ...(r.door ? [r.door] : [])]) {
      const w = 900;
      if (side === "S" || side === "N") {
        const dy = side === "S" ? y0 : y1;
        const dx = x0 + Math.min(r.width - w - 300, 300);
        E.push({ type: "line", layer: "DOOR", x1: dx, y1: dy, x2: dx, y2: dy + (side === "S" ? w : -w) });
        E.push({ type: "arc", layer: "DOOR", cx: dx, cy: dy, r: w, startAngle: side === "S" ? 0 : 270, endAngle: side === "S" ? 90 : 360 });
      } else {
        const dx = side === "W" ? x0 : x1;
        const dy = y0 + Math.min(r.length - w - 300, 300);
        E.push({ type: "line", layer: "DOOR", x1: dx, y1: dy, x2: dx + (side === "W" ? w : -w), y2: dy });
        E.push({ type: "arc", layer: "DOOR", cx: dx, cy: dy, r: w, startAngle: side === "W" ? 0 : 90, endAngle: side === "W" ? 90 : 180 });
      }
    }
    for (const side of [...(r.windows ?? []), ...(r.window ? [r.window] : [])]) {
      const w = Math.min(1200, (side === "N" || side === "S" ? r.width : r.length) * 0.5);
      if (side === "S" || side === "N") {
        const wy = side === "S" ? y0 : y1;
        const wx = (x0 + x1) / 2 - w / 2;
        E.push({ type: "line", layer: "WINDOW", x1: wx, y1: wy, x2: wx + w, y2: wy });
        E.push({ type: "line", layer: "WINDOW", x1: wx, y1: wy - t / 2, x2: wx + w, y2: wy - t / 2 });
        E.push({ type: "line", layer: "WINDOW", x1: wx, y1: wy + t / 2, x2: wx + w, y2: wy + t / 2 });
      } else {
        const wx = side === "W" ? x0 : x1;
        const wy = (y0 + y1) / 2 - w / 2;
        E.push({ type: "line", layer: "WINDOW", x1: wx, y1: wy, x2: wx, y2: wy + w });
        E.push({ type: "line", layer: "WINDOW", x1: wx - t / 2, y1: wy, x2: wx - t / 2, y2: wy + w });
        E.push({ type: "line", layer: "WINDOW", x1: wx + t / 2, y1: wy, x2: wx + t / 2, y2: wy + w });
      }
    }
  }
  if (p.showDimensions !== false) {
    const minX = Math.min(...p.rooms.map((r) => r.x)) - t / 2;
    const minY = Math.min(...p.rooms.map((r) => r.y)) - t / 2;
    const MX = Math.max(...p.rooms.map((r) => r.x + r.width)) + t / 2;
    const MY = Math.max(...p.rooms.map((r) => r.y + r.length)) + t / 2;
    E.push({ type: "dimension", layer: "DIM", x1: minX, y1: minY, x2: MX, y2: minY, offset: -(MY - minY) * 0.1 - 600 });
    E.push({ type: "dimension", layer: "DIM", x1: MX, y1: minY, x2: MX, y2: MY, offset: -(MX - minX) * 0.1 - 600 });
    E.push({ type: "text", layer: "TEXT", x: (minX + MX) / 2, y: MY + 800, text: p.title ?? "FLOOR PLAN", height: 350, align: "center" });
  }
  return { title: p.title ?? "Floor plan", units: "mm", layers: DEFAULT_LAYERS, entities: E, notes: ["Wall thickness " + t + " mm; doors 900 mm; windows 1200 mm. Room dimensions are internal clear dimensions."] };
}

export interface BeamElevationParams { span: number; depth: number; supportWidth?: number; bottomBars: { count: number; dia: number }; topBars?: { count: number; dia: number }; stirrup?: { dia: number; spacing: number; endSpacing?: number; endZone?: number }; title?: string }

export function beamElevation(p: BeamElevationParams): Drawing {
  const L = p.span, D = p.depth, sw = p.supportWidth ?? 300;
  const cover = 25;
  const E: Entity[] = [];
  E.push({ type: "polyline", layer: "OUTLINE", closed: true, points: [[0, 0], [L, 0], [L, D], [0, D]] });
  for (const x of [0, L]) {
    E.push({ type: "hatch", layer: "HATCH", pattern: "concrete", spacing: sw / 6, points: [[x - sw / 2, -D * 0.6], [x + sw / 2, -D * 0.6], [x + sw / 2, 0], [x - sw / 2, 0]] });
  }
  E.push({ type: "line", layer: "REBAR", x1: cover, y1: cover, x2: L - cover, y2: cover });
  E.push({ type: "line", layer: "REBAR", x1: cover, y1: D - cover, x2: L - cover, y2: D - cover });
  const st = p.stirrup ?? { dia: 8, spacing: 150 };
  const endZone = st.endZone ?? Math.min(L / 4, 2 * D);
  const endSp = st.endSpacing ?? st.spacing;
  let x = sw / 2 + 50;
  while (x < L - sw / 2) {
    E.push({ type: "line", layer: "STIRRUP", x1: x, y1: cover, x2: x, y2: D - cover });
    x += x < endZone || x > L - endZone ? endSp : st.spacing;
  }
  E.push({ type: "dimension", layer: "DIM", x1: 0, y1: 0, x2: L, y2: 0, offset: -D * 0.9 });
  E.push({ type: "dimension", layer: "DIM", x1: L, y1: 0, x2: L, y2: D, offset: -D * 0.5 });
  const th = Math.max(20, L / 80);
  E.push({ type: "text", layer: "TEXT", x: L / 2, y: -D * 0.9 - th * 4, text: p.title ?? `BEAM ELEVATION L=${L}`, height: th * 1.3, align: "center" });
  E.push({ type: "text", layer: "TEXT", x: L / 2, y: D + th * 1.5, text: `Ø${st.dia} @ ${endSp} C/C (END ${endZone}) / @ ${st.spacing} C/C (MID)`, height: th, align: "center" });
  E.push({ type: "text", layer: "TEXT", x: L / 2, y: cover - th * 2.5, text: `${p.bottomBars.count}-Ø${p.bottomBars.dia} BOTTOM`, height: th, align: "center" });
  const tb = p.topBars ?? { count: 2, dia: 12 };
  E.push({ type: "text", layer: "TEXT", x: L / 2, y: D + th * 4, text: `${tb.count}-Ø${tb.dia} TOP`, height: th, align: "center" });
  return { title: p.title ?? `Beam elevation L=${L}`, units: "mm", layers: DEFAULT_LAYERS, entities: E };
}
