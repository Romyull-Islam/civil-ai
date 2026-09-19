/**
 * Plot (site) geometry for real-life plot shapes: rectangle, square, trapezoid, four sides + diagonal (as measured by a
 * surveyor / amin), L-shape, triangle, corner-cut (splayed corner plot), flag (panhandle) lot, and custom boundaries
 * given as corner coordinates or as a traverse of lengths and bearings (with closure error and compass-rule adjustment).
 *
 * The plot is placed with its road (front) edge along the x axis at the bottom, interior above it (y towards the rear).
 * Setbacks are applied per edge: road edges → front setback, edges facing away from the road → rear, others → side.
 * The buildable area is found on a fine grid (cell centre inside the plot and at least the setback from every edge),
 * and the largest axis-aligned rectangle inside it is used for room planning. Units: m (ft inputs are converted).
 */
export type Pt = [number, number];
type Common = { units?: "m" | "ft"; roadEdges?: number[] };
export type PlotInput = Common & (
  | { shape: "rectangular"; width?: number; depth?: number }
  | { shape: "square"; side?: number; width?: number }
  | { shape: "trapezoid"; frontWidth: number; rearWidth: number; depth: number; rearOffset?: number }
  | { shape: "quadrilateral"; front: number; right: number; rear: number; left: number; diagonal: number }
  | { shape: "l_shape"; width: number; depth: number; cutWidth: number; cutDepth: number; cutCorner?: "rear_left" | "rear_right" | "front_left" | "front_right" }
  | { shape: "triangle"; front: number; right: number; left: number }
  | { shape: "corner_cut"; width: number; depth: number; chamfer: number; corner?: "front_left" | "front_right" }
  | { shape: "flag"; poleWidth: number; poleLength: number; flagWidth: number; flagDepth: number; pole?: "left" | "right" }
  | { shape: "polygon"; points: Pt[]; frontEdge?: number }
  | { shape: "traverse"; legs: { length: number; bearing: string | number }[]; frontEdge?: number }
);

export interface PlotEdge { index: number; from: Pt; to: Pt; length: number; role: "road" | "rear" | "side" }
export interface PlotGeometry {
  shape: PlotInput["shape"];
  points: Pt[]; // m, counter-clockwise, road edge 0→1 along +x at y = 0 where possible
  area: number; // m²
  perimeter: number; // m
  edges: PlotEdge[];
  closure?: { error: number; precision: string; adjusted: boolean };
  notes: string[];
}

const FT = 0.3048;
const pos = (v: number | undefined, name: string) => { if (!(typeof v === "number" && v > 0)) throw new Error(`${name} must be a positive number`); return v; };
export const polygonArea = (p: Pt[]) => p.reduce((s, [x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2;
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Quadrant bearing ("N 45°30' E", "S12.5W") or azimuth ("123.5", "123°30'", 123.5) → azimuth in degrees from north, clockwise. */
export function parseBearing(b: string | number): number {
  if (typeof b === "number") return ((b % 360) + 360) % 360;
  const s = b.trim().toUpperCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/º/g, "°");
  const dms = (d: string, m?: string, sec?: string) => Number(d) + Number(m ?? 0) / 60 + Number(sec ?? 0) / 3600;
  const q = s.match(/^([NS])\s*(\d+(?:\.\d+)?)\s*(?:[°D\s]\s*(\d+(?:\.\d+)?)\s*(?:['M\s]\s*(\d+(?:\.\d+)?)\s*"?)?)?\s*'?\s*([EW])$/);
  if (q) {
    const a = dms(q[2], q[3], q[4]);
    if (a > 90) throw new Error(`Quadrant bearing angle must be ≤ 90°: ${b}`);
    return q[1] === "N" ? (q[5] === "E" ? a : 360 - a) : q[5] === "E" ? 180 - a : 180 + a;
  }
  const z = s.match(/^(\d+(?:\.\d+)?)\s*(?:°\s*(?:(\d+(?:\.\d+)?)\s*'?\s*(?:(\d+(?:\.\d+)?)\s*"?)?)?)?$/);
  if (z) return dms(z[1], z[2], z[3]) % 360;
  throw new Error(`Cannot read the bearing "${b}". Use e.g. N 45°30' E, S12W, or an azimuth such as 135.5`);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Corner points (before orientation) and default road edges for each shape. */
function rawPoints(inp: PlotInput): { pts: Pt[]; road: number[]; closure?: PlotGeometry["closure"]; notes: string[] } {
  const notes: string[] = [];
  switch (inp.shape) {
    case "rectangular": { const w = pos(inp.width ?? 10, "width"), d = pos(inp.depth ?? 12, "depth"); return { pts: [[0, 0], [w, 0], [w, d], [0, d]], road: [0], notes }; }
    case "square": { const a = pos(inp.side ?? inp.width ?? 10, "side"); return { pts: [[0, 0], [a, 0], [a, a], [0, a]], road: [0], notes }; }
    case "trapezoid": {
      const f = pos(inp.frontWidth, "frontWidth"), r = pos(inp.rearWidth, "rearWidth"), d = pos(inp.depth, "depth");
      const off = inp.rearOffset ?? (f - r) / 2;
      return { pts: [[0, 0], [f, 0], [off + r, d], [off, d]], road: [0], notes };
    }
    case "quadrilateral": {
      const a = pos(inp.front, "front"), b = pos(inp.right, "right"), c = pos(inp.rear, "rear"), l = pos(inp.left, "left"), g = pos(inp.diagonal, "diagonal");
      const tri = (x: number, y: number, z: number, n: string) => { if (x + y <= z || x + z <= y || y + z <= x) throw new Error(`The sides and diagonal do not close (${n}); check the measurements`); };
      tri(a, b, g, "front, right and diagonal"); tri(c, l, g, "rear, left and diagonal");
      // Diagonal from the front-left corner A to the rear-right corner C.
      const cosA = (a * a + g * g - b * b) / (2 * a * g), angA = Math.acos(cosA);
      const C: Pt = [g * Math.cos(angA), g * Math.sin(angA)];
      const cosT = (g * g + l * l - c * c) / (2 * g * l), t = Math.acos(cosT);
      const D: Pt = [l * Math.cos(angA + t), l * Math.sin(angA + t)];
      notes.push("Four sides and the front-left to rear-right diagonal (surveyor's measurement).");
      return { pts: [[0, 0], [a, 0], C, D], road: [0], notes };
    }
    case "l_shape": {
      const w = pos(inp.width, "width"), d = pos(inp.depth, "depth"), cw = pos(inp.cutWidth, "cutWidth"), cd = pos(inp.cutDepth, "cutDepth");
      if (cw >= w || cd >= d) throw new Error("The cut-out must be smaller than the plot");
      const pts: Record<string, Pt[]> = {
        rear_right: [[0, 0], [w, 0], [w, d - cd], [w - cw, d - cd], [w - cw, d], [0, d]],
        rear_left: [[0, 0], [w, 0], [w, d], [cw, d], [cw, d - cd], [0, d - cd]],
        front_right: [[0, 0], [w - cw, 0], [w - cw, cd], [w, cd], [w, d], [0, d]],
        front_left: [[cw, 0], [w, 0], [w, d], [0, d], [0, cd], [cw, cd]],
      };
      return { pts: pts[inp.cutCorner ?? "rear_right"], road: [0], notes };
    }
    case "triangle": {
      const f = pos(inp.front, "front"), r = pos(inp.right, "right"), l = pos(inp.left, "left");
      if (f + r <= l || f + l <= r || r + l <= f) throw new Error("These three sides cannot form a triangle");
      const x = (f * f + l * l - r * r) / (2 * f);
      return { pts: [[0, 0], [f, 0], [x, Math.sqrt(l * l - x * x)]], road: [0], notes };
    }
    case "corner_cut": {
      const w = pos(inp.width, "width"), d = pos(inp.depth, "depth"), c = pos(inp.chamfer, "chamfer");
      if (c >= Math.min(w, d)) throw new Error("The corner cut must be smaller than the plot sides");
      notes.push("Corner plot: the corner cut (splay) is kept free for visibility at the road junction.");
      return inp.corner === "front_left" ? { pts: [[c, 0], [w, 0], [w, d], [0, d], [0, c]], road: [0, 4], notes } : { pts: [[0, 0], [w - c, 0], [w, c], [w, d], [0, d]], road: [0, 1], notes };
    }
    case "flag": {
      const pw = pos(inp.poleWidth, "poleWidth"), pl = pos(inp.poleLength, "poleLength"), fw = pos(inp.flagWidth, "flagWidth"), fd = pos(inp.flagDepth, "flagDepth");
      if (pw >= fw) throw new Error("The access strip (pole) must be narrower than the main plot (flag)");
      notes.push(`Flag (panhandle) lot: ${pw} m wide access strip, ${pl} m long, to the main plot.`);
      return inp.pole === "right"
        ? { pts: [[fw - pw, 0], [fw, 0], [fw, pl + fd], [0, pl + fd], [0, pl], [fw - pw, pl]], road: [0], notes }
        : { pts: [[0, 0], [pw, 0], [pw, pl], [fw, pl], [fw, pl + fd], [0, pl + fd]], road: [0], notes };
    }
    case "polygon": {
      if (!inp.points || inp.points.length < 3) throw new Error("Give at least 3 corner points");
      return { pts: inp.points.map(([x, y]) => [Number(x), Number(y)] as Pt), road: [inp.frontEdge ?? 0], notes };
    }
    case "traverse": {
      if (!inp.legs || inp.legs.length < 3) throw new Error("Give at least 3 boundary legs (length and bearing)");
      const vec = inp.legs.map((l) => { const az = (parseBearing(l.bearing) * Math.PI) / 180, L = pos(l.length, "leg length"); return [L * Math.sin(az), L * Math.cos(az), L] as const; });
      const ex = vec.reduce((s, v) => s + v[0], 0), ey = vec.reduce((s, v) => s + v[1], 0);
      const per = vec.reduce((s, v) => s + v[2], 0), err = Math.hypot(ex, ey);
      // Compass (Bowditch) rule: distribute the misclosure in proportion to leg length.
      const pts: Pt[] = [[0, 0]];
      let x = 0, y = 0;
      for (const [dx, dy, L] of vec.slice(0, -1)) { x += dx - (ex * L) / per; y += dy - (ey * L) / per; pts.push([x, y]); }
      const precision = err < 1e-9 ? "exact" : `1 : ${Math.round(per / err)}`;
      if (err > 0.005) notes.push(`Traverse misclosure ${err.toFixed(3)} m (precision ${precision}); corrected by the compass (Bowditch) rule.${per / err < 1000 ? " This is poor for a boundary survey (1:1000 or better is usual): re-check the lengths and bearings." : ""}`);
      return { pts, road: [inp.frontEdge ?? 0], closure: { error: err, precision, adjusted: err > 0.005 }, notes };
    }
  }
}

export function plotGeometry(input: PlotInput): PlotGeometry {
  const k = input.units === "ft" ? FT : 1;
  const raw = rawPoints(input);
  let pts: Pt[] = raw.pts.map(([x, y]) => [x * k, y * k]);
  let road = (input.roadEdges?.length ? input.roadEdges : raw.road).map((e) => ((e % pts.length) + pts.length) % pts.length);
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(i - j) > 1 && !(i === 0 && j === n - 1) && segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) throw new Error("The boundary crosses itself; list the corners in order around the plot");
  if (Math.abs(polygonArea(pts)) < 1e-6) throw new Error("The plot has no area");
  // Counter-clockwise order; reversing maps edge i to edge n-2-i (mod n).
  if (polygonArea(pts) < 0) { pts = [...pts].reverse(); road = road.map((e) => (((n - 2 - e) % n) + n) % n); }
  // Rotate so the first road edge runs along +x (interior above), then shift to the first quadrant.
  const [a, b] = [pts[road[0]], pts[(road[0] + 1) % n]];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(-ang), s = Math.sin(-ang);
  pts = pts.map(([x, y]) => [(x - a[0]) * c - (y - a[1]) * s, (x - a[0]) * s + (y - a[1]) * c]);
  const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
  pts = pts.map(([x, y]) => [+(x - minX).toFixed(6), +(y - minY).toFixed(6)]);
  // Edge roles: road edges as given; an edge whose outward normal points away from the road (> 135°) is rear; others side.
  const edges: PlotEdge[] = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const nx = q[1] - p[1], ny = -(q[0] - p[0]); // outward normal of a CCW polygon (road edge normal = (0, -1))
    const cosToRoad = -ny / Math.hypot(nx, ny);
    return { index: i, from: p, to: q, length: dist(p, q), role: road.includes(i) ? "road" : cosToRoad < -Math.SQRT1_2 ? "rear" : "side" };
  });
  return { shape: input.shape, points: pts, area: polygonArea(pts), perimeter: edges.reduce((s, e) => s + e.length, 0), edges, closure: raw.closure, notes: raw.notes };
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inside(p: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Buildable area after setbacks and the largest axis-aligned rectangle inside it (road edge at the bottom).
 * Grid cells whose centre is inside the plot and at least the setback (+ half a cell diagonal) from every edge count;
 * results are therefore slightly conservative (by at most one cell, ≈ 1/400 of the plot size).
 */
export function buildableArea(g: PlotGeometry, sb: { front: number; rear: number; side: number }) {
  const W = Math.max(...g.points.map((p) => p[0])), D = Math.max(...g.points.map((p) => p[1]));
  const res = Math.min(0.25, Math.max(0.02, Math.max(W, D) / 400));
  const cols = Math.ceil(W / res), rows = Math.ceil(D / res), half = res * Math.SQRT1_2;
  const need = g.edges.map((e) => (e.role === "road" ? sb.front : e.role === "rear" ? sb.rear : sb.side));
  const ok = new Uint8Array(rows * cols);
  let cells = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p: Pt = [(c + 0.5) * res, (r + 0.5) * res];
    if (!inside(p, g.points)) continue;
    let good = true;
    for (let i = 0; i < g.edges.length && good; i++) if (segDist(p, g.edges[i].from, g.edges[i].to) < need[i] + half) good = false;
    if (good) { ok[r * cols + c] = 1; cells++; }
  }
  // Largest rectangle of buildable cells (histogram method, row by row).
  const h = new Int32Array(cols);
  let best = { area: 0, r0: 0, r1: 0, c0: 0, c1: 0 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) h[c] = ok[r * cols + c] ? h[c] + 1 : 0;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const cur = c === cols ? 0 : h[c];
      while (stack.length && h[stack[stack.length - 1]] >= cur) {
        const top = stack.pop()!, height = h[top], left = stack.length ? stack[stack.length - 1] + 1 : 0, area = height * (c - left);
        if (area > best.area) best = { area, r0: r - height + 1, r1: r, c0: left, c1: c - 1 };
      }
      stack.push(c);
    }
  }
  const rect = best.area ? { x: best.c0 * res, y: best.r0 * res, width: (best.c1 - best.c0 + 1) * res, depth: (best.r1 - best.r0 + 1) * res } : null;
  return { area: cells * res * res, rect, cell: res };
}
