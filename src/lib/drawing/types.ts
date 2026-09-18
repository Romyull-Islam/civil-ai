/** Neutral 2D drawing model shared by the DXF writer, SVG renderer and templates. Units: mm. */

export interface Layer { name: string; color?: number /* AutoCAD color index */ ; lineweight?: number }

export interface LineEntity { type: "line"; x1: number; y1: number; x2: number; y2: number; layer?: string }
export interface PolylineEntity { type: "polyline"; points: [number, number][]; closed?: boolean; layer?: string }
export interface CircleEntity { type: "circle"; cx: number; cy: number; r: number; layer?: string }
export interface ArcEntity { type: "arc"; cx: number; cy: number; r: number; startAngle: number; endAngle: number; layer?: string }
export interface TextEntity { type: "text"; x: number; y: number; text: string; height?: number; rotation?: number; align?: "left" | "center" | "right"; layer?: string }
export interface DimensionEntity {
  type: "dimension";
  x1: number; y1: number; x2: number; y2: number;
  /** offset distance of the dimension line from the measured points (positive = left of direction p1→p2) */
  offset: number;
  text?: string;
  layer?: string;
}
export interface HatchEntity { type: "hatch"; points: [number, number][]; pattern?: "concrete" | "earth" | "steel" | "solid"; spacing?: number; layer?: string }

export type Entity = LineEntity | PolylineEntity | CircleEntity | ArcEntity | TextEntity | DimensionEntity | HatchEntity;

export interface Drawing {
  title: string;
  units: "mm" | "m" | "in" | "ft";
  layers: Layer[];
  entities: Entity[];
  /** optional notes shown under the drawing */
  notes?: string[];
}

export const DEFAULT_LAYERS: Layer[] = [
  { name: "OUTLINE", color: 7 },
  { name: "REBAR", color: 1 },
  { name: "STIRRUP", color: 3 },
  { name: "DIM", color: 4 },
  { name: "TEXT", color: 2 },
  { name: "HATCH", color: 8 },
  { name: "CENTER", color: 6 },
  { name: "WALL", color: 7 },
  { name: "DOOR", color: 30 },
  { name: "WINDOW", color: 5 },
];

export function bounds(d: Drawing): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const e of d.entities) {
    switch (e.type) {
      case "line": add(e.x1, e.y1); add(e.x2, e.y2); break;
      case "polyline": case "hatch": e.points.forEach(([x, y]) => add(x, y)); break;
      case "circle": case "arc": add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
      case "text": add(e.x, e.y); add(e.x + (e.height ?? 2.5) * 0.6 * e.text.length, e.y + (e.height ?? 2.5)); break;
      case "dimension": {
        const { dx, dy } = dimGeometry(e);
        add(e.x1, e.y1); add(e.x2, e.y2); add(e.x1 + dx, e.y1 + dy); add(e.x2 + dx, e.y2 + dy); break;
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return { minX, minY, maxX, maxY };
}

/** Perpendicular offset vector for a dimension entity. */
export function dimGeometry(e: DimensionEntity) {
  const vx = e.x2 - e.x1;
  const vy = e.y2 - e.y1;
  const len = Math.hypot(vx, vy) || 1;
  const nx = -vy / len;
  const ny = vx / len;
  return { dx: nx * e.offset, dy: ny * e.offset, length: len, ux: vx / len, uy: vy / len };
}

/** Dimension text height and tick size proportional to the drawing extent (readable on a 300 mm section and a 10 m plan alike). */
export function dimScale(d: Drawing): { text: number; tick: number; ext: number } {
  const b = bounds(d);
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 100;
  const text = Math.max(2.5, extent / 60);
  return { text, tick: text * 0.6, ext: text * 0.5 };
}

export function formatDimText(e: DimensionEntity, units: Drawing["units"]): string {
  if (e.text) return e.text;
  const { length } = dimGeometry(e);
  if (units === "m") return `${(length / 1000).toFixed(2)}`;
  return `${Math.round(length)}`;
}
