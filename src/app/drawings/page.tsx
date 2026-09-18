"use client";
import { useEffect, useMemo, useState } from "react";
import { PencilRuler } from "lucide-react";
import { SchemaForm, defaultValues } from "@/components/SchemaForm";
import { DrawingViewer } from "@/components/DrawingViewer";
import type { ToolOutput } from "@/lib/tools";

interface ToolMeta { name: string; category: string; description: string; schema: Record<string, unknown> }
const PRESETS: Record<string, Record<string, unknown>> = {
  plan_building: { plot: { shape: "rectangular", width: 12, depth: 15 }, frontSide: "S", buildingType: "single_family", storeys: 2, bedrooms: 3, bathrooms: 2, garage: true, dining: true, windowsPerRoom: 1, wallThickness: 230, corridorWidth: 1.2 },
  plan_layout: { plotWidth: 10, plotDepth: 12, setback: { front: 1.5, rear: 1.5, side: 1 }, rooms: [{ name: "Living", area: 20 }, { name: "Kitchen", area: 8 }, { name: "Bedroom 1", area: 14 }, { name: "Bedroom 2", area: 12 }, { name: "Bath", area: 3 }], wallThickness: 230, corridorWidth: 1.2, entrySide: "S", draw: true },
  draw_beam_section: { b: 300, D: 500, cover: 25, bottomBars: { count: 4, dia: 20 }, topBars: { count: 2, dia: 12 }, stirrup: { dia: 8, spacing: 150 } },
  draw_beam_elevation: { span: 6000, depth: 500, supportWidth: 300, bottomBars: { count: 4, dia: 20 }, topBars: { count: 2, dia: 12 }, stirrup: { dia: 8, spacing: 200, endSpacing: 100, endZone: 1200 } },
  draw_column_section: { b: 400, D: 400, cover: 40, bars: { count: 8, dia: 16 }, tie: { dia: 8, spacing: 200 } },
  draw_footing: { side: 2200, depth: 500, columnB: 400, columnD: 400, bars: { dia: 16, spacing: 150 }, cover: 50 },
  draw_floor_plan: { rooms: [{ name: "Living", x: 0, y: 0, width: 4500, length: 5500, door: "S", window: "W" }, { name: "Kitchen", x: 4730, y: 0, width: 3000, length: 3500, door: "W", window: "E" }, { name: "Bedroom", x: 4730, y: 3730, width: 3000, length: 4200, door: "W", window: "E" }, { name: "Bath", x: 0, y: 5730, width: 2000, length: 2400, door: "E" }], wallThickness: 230, title: "GROUND FLOOR PLAN" },
  draw_custom: { title: "Retaining wall section", units: "mm", entities: [{ type: "polyline", layer: "OUTLINE", closed: true, points: [[0, 0], [2500, 0], [2500, 400], [1800, 400], [1700, 3400], [1400, 3400], [1300, 400], [0, 400]] }, { type: "hatch", layer: "HATCH", pattern: "earth", points: [[1800, 400], [2500, 400], [2500, 3400], [1700, 3400]] }, { type: "dimension", layer: "DIM", x1: 0, y1: 0, x2: 2500, y2: 0, offset: -300 }, { type: "dimension", layer: "DIM", x1: 2500, y1: 0, x2: 2500, y2: 3400, offset: -1000 }, { type: "text", layer: "TEXT", x: 1250, y: -700, text: "CANTILEVER RETAINING WALL", height: 100, align: "center" }] },
};

export default function DrawingsPage() {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [output, setOutput] = useState<(ToolOutput & { error?: string }) | null>(null);
  const generate = async (name: string, input: Record<string, unknown>) => {
    const res = await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, input }) });
    setOutput(await res.json());
  };
  const pick = (t: ToolMeta) => { const v = defaultValues(t.schema as never, PRESETS[t.name] ?? {}); setSelected(t.name); setValues(v); setOutput(null); generate(t.name, v); };
  useEffect(() => { fetch("/api/tools").then((r) => r.json()).then((t: ToolMeta[]) => { const list = t.filter((x) => x.category === "drawing"); setTools(list); if (list.length) pick(list[0]); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tool = useMemo(() => tools.find((t) => t.name === selected), [tools, selected]);
  const run = () => { if (tool) generate(tool.name, values); };
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 grid gap-4">
        <div className="flex items-center gap-2"><PencilRuler className="text-accent" /><h1 className="text-lg font-semibold">Drawings & planning → DXF</h1></div>
        <p className="text-sm text-muted">Plan a building from a brief (plot, direction, type, storeys, rooms), arrange rooms on a plot, or generate RC details from parameters, preview, then download DXF for AutoCAD/BricsCAD/LibreCAD/Revit, or SVG/PNG for reports. In the Assistant, just ask for a drawing and the AI fills these same templates.</p>
        <div className="flex flex-wrap gap-2">{tools.map((t) => <button key={t.name} className={`btn btn-sm ${selected === t.name ? "btn-primary" : ""}`} onClick={() => pick(t)}>{t.name.replace("draw_", "").replace(/_/g, " ")}</button>)}</div>
        {tool && (
          <div className="grid lg:grid-cols-[380px_1fr] gap-4 items-start">
            <div className="card p-4 grid gap-3">
              <p className="text-xs text-muted">{tool.description}</p>
              <SchemaForm schema={tool.schema as never} values={values} onChange={setValues} />
              <button className="btn btn-primary" onClick={run}>Generate</button>
            </div>
            <div>
              {output?.error && <div className="card p-3 text-err text-sm">{output.error}</div>}
              {output?.display?.kind === "drawing" && <DrawingViewer drawing={output.display.drawing} svg={output.display.svg} height={520} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
