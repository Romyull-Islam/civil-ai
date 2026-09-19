"use client";
import { useRef, useState } from "react";
import { Download, ZoomIn, ZoomOut, Maximize2, CloudUpload } from "lucide-react";
import { useSession, accountsMode } from "@/lib/client/session";
import type { Drawing } from "@/lib/drawing/types";
import { toDxf } from "@/lib/drawing/dxf";
import { toSvg } from "@/lib/drawing/svg";

function download(name: string, content: string | Blob, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "drawing";

export function DrawingViewer({ drawing, svg, height = 360 }: { drawing: Drawing; svg?: string; height?: number }) {
  const session = useSession();
  const [saved, setSaved] = useState<string | null>(null);
  const saveToAccount = async () => { const r = await fetch("/api/saves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "drawing", title: drawing.title, payload: drawing }) }); const j = await r.json(); setSaved(r.ok ? "Saved to your account" : j.error); setTimeout(() => setSaved(null), 4000); };
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const markup = svg || toSvg(drawing); // shared/backed-up copies store geometry only (svg ""), so re-render

  const exportPng = async () => {
    const svgBlob = new Blob([toSvg(drawing, { background: "#ffffff" }).replace('style="color:#e8e8e8"', 'style="color:#111"')], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("svg load")); img.src = url; });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(6000, img.width * scale || 1600); canvas.height = Math.min(6000, img.height * scale || 1000);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => b && download(`${slug(drawing.title)}.png`, b, "image/png"), "image/png");
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <span className="font-medium truncate">{drawing.title}</span>
        <span className="badge">{drawing.units}</span>
        <span className="badge">{drawing.entities.length} entities</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} title="Zoom in"><ZoomIn size={14} /></button>
          <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))} title="Zoom out"><ZoomOut size={14} /></button>
          <button className="btn btn-sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Fit"><Maximize2 size={14} /></button>
          <button className="btn btn-sm" onClick={() => download(`${slug(drawing.title)}.dxf`, toDxf(drawing), "application/dxf")} title="Download DXF (AutoCAD, BricsCAD, LibreCAD, Revit)"><Download size={14} /> DXF</button>
          <button className="btn btn-sm" onClick={() => download(`${slug(drawing.title)}.svg`, markup, "image/svg+xml")}><Download size={14} /> SVG</button>
          <button className="btn btn-sm" onClick={exportPng}><Download size={14} /> PNG</button>
          {accountsMode(session) && (session?.cloudQuota?.limitBytes ?? 0) > 0 && <button className="btn btn-sm" onClick={saveToAccount} title="Save to my account (cloud)"><CloudUpload size={14} /> Save</button>}
        </div>
      </div>
      <div
        className="relative overflow-hidden bg-[#0b0e12] cursor-grab active:cursor-grabbing select-none"
        style={{ height }}
        onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.9)))); }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }); }}
        onPointerUp={() => (drag.current = null)}
      >
        <div className="absolute inset-0 flex items-center justify-center p-3" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }}>
          <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: markup }} />
        </div>
      </div>
      {saved && <div className="px-3 py-1 text-xs text-ok border-t border-border">{saved}</div>}
      {drawing.notes?.length ? <div className="px-3 py-2 text-xs text-muted border-t border-border">{drawing.notes.join(" · ")}</div> : null}
    </div>
  );
}
