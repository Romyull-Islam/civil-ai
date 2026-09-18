/**
 * Minimal DXF (AC1009 / R12 ASCII) writer. R12 is the most widely readable DXF
 * flavour (AutoCAD, BricsCAD, LibreCAD, QCAD, FreeCAD, DraftSight, Revit import).
 * Dimensions are written as exploded geometry (lines + ticks + text) so no DIMSTYLE tables are needed.
 */
import { Drawing, Entity, DEFAULT_LAYERS, dimGeometry, formatDimText, dimScale, HatchEntity } from "./types";

const pair = (code: number, value: string | number) => `${code}\n${typeof value === "number" ? fmt(value) : value}\n`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, ""));

export function hatchLines(h: HatchEntity): [number, number, number, number][] {
  // Simple 45° hatch clipped to polygon bounding box, then clipped to polygon using scanline on the hatch line.
  const pts = h.points;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spacing = h.spacing ?? Math.max(4, (maxX - minX) / 15);
  const out: [number, number, number, number][] = [];
  const angle = h.pattern === "earth" ? Math.PI / 4 : h.pattern === "steel" ? -Math.PI / 4 : Math.PI / 4;
  const c = Math.cos(angle), s = Math.sin(angle);
  const span = Math.hypot(maxX - minX, maxY - minY);
  for (let d = -span; d <= span; d += spacing) {
    // line: points p = center + d*n + t*u
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const nx = -s, ny = c;
    const px = cx + nx * d, py = cy + ny * d;
    // intersections with polygon edges
    const ts: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const ex = bx - ax, ey = by - ay;
      const den = c * ey - s * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - px) * ey - (ay - py) * ex) / den;
      const u = ((ax - px) * s - (ay - py) * c) / den;
      if (u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i += 2) out.push([px + c * ts[i], py + s * ts[i], px + c * ts[i + 1], py + s * ts[i + 1]]);
  }
  return out;
}

function entityDxf(e: Entity, units: Drawing["units"], ds: { text: number; tick: number; ext: number } = { text: 2.5, tick: 2, ext: 1.5 }): string {
  const layer = e.layer ?? "0";
  switch (e.type) {
    case "line":
      return pair(0, "LINE") + pair(8, layer) + pair(10, e.x1) + pair(20, e.y1) + pair(30, 0) + pair(11, e.x2) + pair(21, e.y2) + pair(31, 0);
    case "circle":
      return pair(0, "CIRCLE") + pair(8, layer) + pair(10, e.cx) + pair(20, e.cy) + pair(30, 0) + pair(40, e.r);
    case "arc":
      return pair(0, "ARC") + pair(8, layer) + pair(10, e.cx) + pair(20, e.cy) + pair(30, 0) + pair(40, e.r) + pair(50, e.startAngle) + pair(51, e.endAngle);
    case "text": {
      const h = e.height ?? 2.5;
      const align = e.align === "center" ? 1 : e.align === "right" ? 2 : 0;
      let s = pair(0, "TEXT") + pair(8, layer) + pair(10, e.x) + pair(20, e.y) + pair(30, 0) + pair(40, h) + pair(1, e.text) + pair(50, e.rotation ?? 0);
      if (align) s += pair(72, align) + pair(11, e.x) + pair(21, e.y) + pair(31, 0);
      return s;
    }
    case "polyline": {
      let s = pair(0, "POLYLINE") + pair(8, layer) + pair(66, 1) + pair(70, e.closed ? 1 : 0);
      for (const [x, y] of e.points) s += pair(0, "VERTEX") + pair(8, layer) + pair(10, x) + pair(20, y) + pair(30, 0);
      s += pair(0, "SEQEND") + pair(8, layer);
      return s;
    }
    case "hatch": {
      let s = entityDxf({ type: "polyline", points: e.points, closed: true, layer }, units);
      for (const [x1, y1, x2, y2] of hatchLines(e)) s += entityDxf({ type: "line", x1, y1, x2, y2, layer }, units);
      return s;
    }
    case "dimension": {
      const { dx, dy, ux, uy } = dimGeometry(e);
      const tick = ds.tick;
      const ext = ds.ext;
      const ax = e.x1 + dx, ay = e.y1 + dy, bx = e.x2 + dx, by = e.y2 + dy;
      const n = Math.hypot(dx, dy) || 1;
      const ox = dx / n * ext, oy = dy / n * ext;
      let s = "";
      s += entityDxf({ type: "line", x1: e.x1, y1: e.y1, x2: ax + ox, y2: ay + oy, layer }, units);
      s += entityDxf({ type: "line", x1: e.x2, y1: e.y2, x2: bx + ox, y2: by + oy, layer }, units);
      s += entityDxf({ type: "line", x1: ax, y1: ay, x2: bx, y2: by, layer }, units);
      // oblique ticks
      for (const [px, py] of [[ax, ay], [bx, by]]) {
        s += entityDxf({ type: "line", x1: px - (ux - dx / n) * tick / 1.4, y1: py - (uy - dy / n) * tick / 1.4, x2: px + (ux - dx / n) * tick / 1.4, y2: py + (uy - dy / n) * tick / 1.4, layer }, units);
      }
      const mx = (ax + bx) / 2 + dx / n * ds.text * 0.5, my = (ay + by) / 2 + dy / n * ds.text * 0.5;
      const rot = (Math.atan2(uy, ux) * 180) / Math.PI;
      s += entityDxf({ type: "text", x: mx, y: my, text: formatDimText(e, units), height: ds.text, rotation: rot, align: "center", layer }, units);
      return s;
    }
  }
}

export function toDxf(d: Drawing): string {
  const layers = d.layers.length ? d.layers : DEFAULT_LAYERS;
  let s = "";
  s += pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$ACADVER") + pair(1, "AC1009") + pair(9, "$INSUNITS") + pair(70, d.units === "mm" ? 4 : d.units === "m" ? 6 : d.units === "in" ? 1 : 2) + pair(0, "ENDSEC");
  s += pair(0, "SECTION") + pair(2, "TABLES");
  s += pair(0, "TABLE") + pair(2, "LAYER") + pair(70, layers.length);
  for (const l of layers) s += pair(0, "LAYER") + pair(2, l.name) + pair(70, 0) + pair(62, l.color ?? 7) + pair(6, "CONTINUOUS");
  s += pair(0, "ENDTAB");
  s += pair(0, "TABLE") + pair(2, "STYLE") + pair(70, 1) + pair(0, "STYLE") + pair(2, "STANDARD") + pair(70, 0) + pair(40, 0) + pair(41, 1) + pair(50, 0) + pair(71, 0) + pair(42, 2.5) + pair(3, "txt") + pair(4, "") + pair(0, "ENDTAB");
  s += pair(0, "ENDSEC");
  s += pair(0, "SECTION") + pair(2, "ENTITIES");
  const ds = dimScale(d);
  for (const e of d.entities) s += entityDxf(e, d.units, ds);
  s += pair(0, "ENDSEC") + pair(0, "EOF");
  return s;
}
