import { Drawing, bounds, dimGeometry, formatDimText, dimScale, DEFAULT_LAYERS } from "./types";
import { hatchLines } from "./dxf";

const ACI_COLORS: Record<number, string> = { 1: "#e5484d", 2: "#d4a017", 3: "#30a46c", 4: "#0090ff", 5: "#3e63dd", 6: "#d6409f", 7: "currentColor", 8: "#8b8d98", 9: "#c0c0c0", 30: "#f76b15" };

export function toSvg(d: Drawing, opts: { width?: number; height?: number; padding?: number; background?: string } = {}): string {
  const b = bounds(d);
  const pad = opts.padding ?? Math.max(10, (b.maxX - b.minX) * 0.08);
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const layerColor = (name?: string) => {
    const l = (d.layers.length ? d.layers : DEFAULT_LAYERS).find((x) => x.name === name);
    return ACI_COLORS[l?.color ?? 7] ?? "currentColor";
  };
  const sw = Math.max(0.2, w / 600);
  const ds = dimScale(d);
  const parts: string[] = [];
  // Flip Y: SVG y grows downward; drawing y grows upward.
  const X = (x: number) => x - b.minX + pad;
  const Y = (y: number) => b.maxY - y + pad;
  for (const e of d.entities) {
    const stroke = layerColor(e.layer);
    switch (e.type) {
      case "line":
        parts.push(`<line x1="${X(e.x1)}" y1="${Y(e.y1)}" x2="${X(e.x2)}" y2="${Y(e.y2)}" stroke="${stroke}" stroke-width="${sw}"/>`);
        break;
      case "polyline":
        parts.push(`<polyline points="${e.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ") + (e.closed ? ` ${X(e.points[0][0])},${Y(e.points[0][1])}` : "")}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`);
        break;
      case "circle":
        parts.push(`<circle cx="${X(e.cx)}" cy="${Y(e.cy)}" r="${e.r}" fill="${e.layer === "REBAR" ? stroke : "none"}" stroke="${stroke}" stroke-width="${sw}"/>`);
        break;
      case "arc": {
        const a0 = (e.startAngle * Math.PI) / 180, a1 = (e.endAngle * Math.PI) / 180;
        const sx = e.cx + e.r * Math.cos(a0), sy = e.cy + e.r * Math.sin(a0);
        const ex = e.cx + e.r * Math.cos(a1), ey = e.cy + e.r * Math.sin(a1);
        let sweep = e.endAngle - e.startAngle; while (sweep < 0) sweep += 360;
        parts.push(`<path d="M ${X(sx)} ${Y(sy)} A ${e.r} ${e.r} 0 ${sweep > 180 ? 1 : 0} 0 ${X(ex)} ${Y(ey)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`);
        break;
      }
      case "text": {
        const hgt = e.height ?? 2.5;
        const anchor = e.align === "center" ? "middle" : e.align === "right" ? "end" : "start";
        const rot = e.rotation ? ` transform="rotate(${-e.rotation} ${X(e.x)} ${Y(e.y)})"` : "";
        parts.push(`<text x="${X(e.x)}" y="${Y(e.y)}" font-size="${hgt * 1.3}" font-family="ui-monospace, monospace" text-anchor="${anchor}" fill="${stroke}"${rot}>${escapeXml(e.text)}</text>`);
        break;
      }
      case "hatch":
        parts.push(`<polygon points="${e.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`);
        for (const [x1, y1, x2, y2] of hatchLines(e)) parts.push(`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${stroke}" stroke-width="${sw * 0.6}" opacity="0.7"/>`);
        break;
      case "dimension": {
        const { dx, dy, ux, uy } = dimGeometry(e);
        const n = Math.hypot(dx, dy) || 1;
        const ax = e.x1 + dx, ay = e.y1 + dy, bx = e.x2 + dx, by = e.y2 + dy;
        const ext = ds.ext;
        parts.push(`<g stroke="${stroke}" stroke-width="${sw * 0.7}" fill="none">`);
        parts.push(`<line x1="${X(e.x1)}" y1="${Y(e.y1)}" x2="${X(ax + dx / n * ext)}" y2="${Y(ay + dy / n * ext)}"/>`);
        parts.push(`<line x1="${X(e.x2)}" y1="${Y(e.y2)}" x2="${X(bx + dx / n * ext)}" y2="${Y(by + dy / n * ext)}"/>`);
        parts.push(`<line x1="${X(ax)}" y1="${Y(ay)}" x2="${X(bx)}" y2="${Y(by)}"/>`);
        const t = ds.tick;
        for (const [px, py] of [[ax, ay], [bx, by]]) parts.push(`<line x1="${X(px - (ux - dx / n) * t / 1.4)}" y1="${Y(py - (uy - dy / n) * t / 1.4)}" x2="${X(px + (ux - dx / n) * t / 1.4)}" y2="${Y(py + (uy - dy / n) * t / 1.4)}"/>`);
        parts.push(`</g>`);
        const mx = (ax + bx) / 2 + dx / n * ds.text * 0.6, my = (ay + by) / 2 + dy / n * ds.text * 0.6;
        const rot = (Math.atan2(uy, ux) * 180) / Math.PI;
        parts.push(`<text x="${X(mx)}" y="${Y(my)}" font-size="${ds.text * 1.3}" font-family="ui-monospace, monospace" text-anchor="middle" fill="${stroke}" transform="rotate(${-rot} ${X(mx)} ${Y(my)})">${escapeXml(formatDimText(e, d.units))}</text>`);
        break;
      }
    }
  }
  const bg = opts.background ? `<rect width="100%" height="100%" fill="${opts.background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ${opts.width ? `width="${opts.width}"` : ""} ${opts.height ? `height="${opts.height}"` : ""} style="color:#e8e8e8">${bg}${parts.join("")}</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
