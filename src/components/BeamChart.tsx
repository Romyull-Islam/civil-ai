"use client";
import type { BeamResult } from "@/lib/eng/beam";

function Series({ x, y, color, label, unit, span }: { x: number[]; y: number[]; color: string; label: string; unit: string; span: number }) {
  const W = 560, H = 150, padL = 44, padR = 12, padT = 18, padB = 22;
  const maxAbs = Math.max(1e-9, ...y.map((v) => Math.abs(v)));
  const sx = (v: number) => padL + (v / span) * (W - padL - padR);
  const sy = (v: number) => padT + (H - padT - padB) / 2 - (v / maxAbs) * ((H - padT - padB) / 2);
  const path = x.map((xi, i) => `${i ? "L" : "M"}${sx(xi).toFixed(1)},${sy(y[i]).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(x[x.length - 1]).toFixed(1)},${sy(0)} L${sx(x[0]).toFixed(1)},${sy(0)} Z`;
  let iMax = 0; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[iMax])) iMax = i;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${label} diagram`}>
      <text x={padL} y={12} fontSize="11" fill="currentColor" opacity={0.8}>{label} ({unit})</text>
      <line x1={padL} x2={W - padR} y1={sy(0)} y2={sy(0)} stroke="currentColor" opacity={0.35} />
      <path d={area} fill={color} opacity={0.18} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
      <text x={padL - 4} y={sy(maxAbs) + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.7}>{maxAbs.toPrecision(3)}</text>
      <text x={padL - 4} y={sy(-maxAbs) + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.7}>-{maxAbs.toPrecision(3)}</text>
      <text x={padL} y={H - 6} fontSize="10" fill="currentColor" opacity={0.7}>0</text>
      <text x={W - padR} y={H - 6} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.7}>{span} m</text>
      <circle cx={sx(x[iMax])} cy={sy(y[iMax])} r={3} fill={color} />
      <text x={Math.min(sx(x[iMax]) + 6, W - 80)} y={sy(y[iMax]) - 6} fontSize="10" fill="currentColor">{y[iMax].toPrecision(4)} @ {x[iMax].toFixed(2)} m</text>
    </svg>
  );
}

export function BeamChart({ result }: { result: BeamResult }) {
  const span = result.input.span;
  return (
    <div className="grid gap-2">
      <div className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
        <span>RA = <b>{result.reactions.RA.toFixed(2)} kN</b></span>
        <span>RB = <b>{result.reactions.RB.toFixed(2)} kN</b></span>
        {result.reactions.MA !== 0 && <span>MA = <b>{result.reactions.MA.toFixed(2)} kN·m</b></span>}
        {result.reactions.MB !== 0 && <span>MB = <b>{result.reactions.MB.toFixed(2)} kN·m</b></span>}
        {result.maxDeflection && <span>δmax = <b>{result.maxDeflection.value.toFixed(2)} mm</b> at {result.maxDeflection.x.toFixed(2)} m</span>}
      </div>
      <Series x={result.x} y={result.shear} color="#38bdf8" label="Shear force" unit="kN" span={span} />
      <Series x={result.x} y={result.moment} color="#f5a524" label="Bending moment (sagging +)" unit="kN·m" span={span} />
      {result.deflection && <Series x={result.x} y={result.deflection.map((d) => -d)} color="#34d399" label="Deflection (downward shown below axis)" unit="mm" span={span} />}
    </div>
  );
}
