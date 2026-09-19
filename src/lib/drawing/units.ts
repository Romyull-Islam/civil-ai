/**
 * US drawings: the templates draw in millimetres; this converts a finished drawing to inches (DXF $INSUNITS = inches,
 * dimensions in feet and inches) and rewrites labels: metric-size bar marks of US bars ("Ø19.05") become "#6",
 * spacings and covers become inches (spacings rounded DOWN to 1/2 in so they never exceed the design spacing),
 * and room sizes in metres become feet-inches.
 */
import type { Drawing, Entity } from "./types";
import { nameOf } from "@/lib/eng/rebar";

const frac = (x: number, step: number) => { const n = Math.round(x / step) * step; const whole = Math.floor(n + 1e-9); const f = n - whole; const q = Math.round(f / step); const den = Math.round(1 / step); const g = (a: number, b: number): number => (b ? g(b, a % b) : a); const d = g(q, den); return q ? `${whole ? `${whole} ` : ""}${q / d}/${den / d}` : `${whole}`; };
/** Inches as text: 7 1/2" (rounded to `step` in, default 1/2). */
export const inches = (inch: number, step = 0.5) => `${frac(inch, step)}"`;
/** Feet-inches for lengths in inches: 30'-6". */
export const feetInches = (inch: number, step = 0.5) => { const r = Math.round(inch / step) * step; const ft = Math.floor(r / 12 + 1e-9); const i = r - ft * 12; return ft ? `${ft}'-${frac(i, step)}"` : `${frac(i, step)}"`; };
const spacingIn = (mm: number) => inches(Math.floor(mm / 25.4 / 0.5 + 1e-9) * 0.5);

export function usLabel(text: string): string {
  return text
    .replace(/Ø(\d+(?:\.\d+)?)/g, (_, v) => nameOf(Number(v), "US"))
    .replace(/@ (\d+(?:\.\d+)?)(?: mm)?( [cC]\/[cC])?/g, (_, v, cc) => `@ ${spacingIn(Number(v))}${cc ?? ""}`)
    .replace(/(\d+(?:\.\d+)?) mm²\/m/g, (_, v) => `${((Number(v) / 645.16) * 0.3048).toFixed(3)} in²/ft`)
    .replace(/COVER (\d+(?:\.\d+)?)(?: mm)?/g, (_, v) => `COVER ${inches(Number(v) / 25.4, 0.25)}`)
    .replace(/(\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) m\b/g, (_, a, b) => `${feetInches((Number(a) * 1000) / 25.4)} x ${feetInches((Number(b) * 1000) / 25.4)}`)
    .replace(/(\d+(?:\.\d+)?) m( \(ROAD\))?$/, (_, a, road) => `${feetInches((Number(a) * 1000) / 25.4)}${road ?? ""}`);
}

export function drawingToInches(d: Drawing): Drawing {
  if (d.units !== "mm") return d;
  const k = 1 / 25.4;
  const P = (pts: [number, number][]) => pts.map(([x, y]) => [x * k, y * k] as [number, number]);
  const entities = d.entities.map((e): Entity => {
    switch (e.type) {
      case "line": return { ...e, x1: e.x1 * k, y1: e.y1 * k, x2: e.x2 * k, y2: e.y2 * k };
      case "polyline": return { ...e, points: P(e.points) };
      case "hatch": return { ...e, points: P(e.points), spacing: e.spacing !== undefined ? e.spacing * k : undefined };
      case "circle": return { ...e, cx: e.cx * k, cy: e.cy * k, r: e.r * k };
      case "arc": return { ...e, cx: e.cx * k, cy: e.cy * k, r: e.r * k };
      case "text": return { ...e, x: e.x * k, y: e.y * k, height: e.height !== undefined ? e.height * k : undefined, text: usLabel(e.text) };
      case "dimension": return { ...e, x1: e.x1 * k, y1: e.y1 * k, x2: e.x2 * k, y2: e.y2 * k, offset: e.offset * k, text: e.text ? usLabel(e.text) : undefined };
    }
  });
  return { ...d, units: "in", entities, notes: d.notes?.map(usLabel) };
}
