"use client";
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { SchemaForm, defaultValues } from "@/components/SchemaForm";
import { ToolCard } from "@/components/ToolCard";
import type { ToolOutput } from "@/lib/tools";

interface ToolMeta { name: string; category: string; description: string; schema: Record<string, unknown> }
const CATS: Record<string, string> = { analysis: "Analysis", design: "Design", geotech: "Geotechnical", transport: "Roads & pavements", water: "Water & drainage", materials: "Concrete & materials", quantities: "Quantities & BOQ", management: "Cost & schedule", utility: "Utilities", reference: "Reference", drawing: "Drawings" };
/** One colour per category (heading, marker and selected item), readable in light and dark themes. */
const CAT_COLOR: Record<string, { text: string; dot: string; active: string }> = {
  analysis: { text: "text-sky-600 dark:text-sky-400", dot: "bg-sky-500", active: "border-sky-500 bg-sky-500/10" },
  design: { text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500", active: "border-amber-500 bg-amber-500/10" },
  geotech: { text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", active: "border-emerald-500 bg-emerald-500/10" },
  transport: { text: "text-indigo-600 dark:text-indigo-400", dot: "bg-indigo-500", active: "border-indigo-500 bg-indigo-500/10" },
  water: { text: "text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500", active: "border-cyan-500 bg-cyan-500/10" },
  materials: { text: "text-lime-700 dark:text-lime-400", dot: "bg-lime-500", active: "border-lime-500 bg-lime-500/10" },
  quantities: { text: "text-violet-600 dark:text-violet-400", dot: "bg-violet-500", active: "border-violet-500 bg-violet-500/10" },
  management: { text: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500", active: "border-orange-500 bg-orange-500/10" },
  utility: { text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500", active: "border-rose-500 bg-rose-500/10" },
  reference: { text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500", active: "border-teal-500 bg-teal-500/10" },
};
const FALLBACK_COLOR = { text: "text-muted", dot: "bg-muted", active: "border-border bg-elev2" };
/** "design_rc_beam" → "Design RC beam" */
const toolLabel = (name: string) => name.replace(/_/g, " ").replace(/\b(rc|boq|sbc|dxf)\b/g, (m) => m.toUpperCase()).replace(/^./, (c) => c.toUpperCase());

/** Starting values for each calculator: typical Bangladeshi work (BNBC 2020, f'c 25 MPa, 500 MPa rebar) unless noted. */
const PRESETS: Record<string, Record<string, unknown>> = {
  analyze_beam: { span: 6, support: "simply_supported", loads: [{ type: "udl", magnitude: 20 }], E: 200000, section: { b: 300, h: 500 } },
  design_rc_beam: { code: "BNBC2020", b: 250, D: 450, fck: 25, fy: 500, Mu: 120, Vu: 90, mainBarDia: 16, span: 5, support: "one_end_continuous" },
  design_rc_column: { code: "BNBC2020", b: 300, D: 400, fck: 25, fy: 500, Pu: 1200, Mux: 60, Muy: 25, unsupportedLength: 3000, curvature: "double", endMomentRatio: 0.5 },
  design_one_way_slab: { code: "BNBC2020", span: 3.5, liveLoad: 2, floorFinish: 1.2, fck: 25, fy: 500, cover: 20, support: "one_end_continuous" },
  design_isolated_footing: { code: "BNBC2020", columnB: 300, columnD: 400, deadLoad: 600, liveLoad: 250, safeBearingCapacity: 150, fck: 25, fy: 500 },
  design_steel_beam: { code: "IS800", span: 6, factoredUDL: 30, serviceUDL: 20, unbracedLength: 3 },
  bearing_capacity: { cohesion: 10, frictionAngle: 30, unitWeight: 18, depth: 1.5, width: 2, shape: "square", factorOfSafety: 3 },
  settlement: { mode: "clay", footingWidth: 2, netPressure: 150, layers: [{ thickness: 3, e0: 0.9, Cc: 0.25, sigma0: 60, midDepthBelowBase: 1.5 }] },
  earth_pressure: { frictionAngle: 30, height: 4, unitWeight: 18, surcharge: 10 },
  concrete_materials: { volume: 100, volumeUnit: "cft", ratio: "1:2:4", wastagePercent: 3 },
  rebar_schedule: { items: [{ label: "Bottom bars", diameter: 16, length: 6.3, count: 4 }, { label: "Stirrups", diameter: 8, length: 1.5, count: 40 }], wastagePercent: 3 },
  cost_estimate: { project: "Example building: foundation work", currency: "BDT", rateSource: "EXAMPLE RATES ONLY: replace with your schedule of rates or quotations", overheadPercent: 5, profitPercent: 10, vatPercent: 7.5, items: [{ description: "Earth work in excavation", unit: "m3", quantity: 120, rate: 350, category: "Earthwork" }, { description: "RCC work in footing (1:1.5:3)", unit: "m3", quantity: 38, rate: 14500, category: "Concrete" }, { description: "Reinforcement (500 W), supplied and fixed", unit: "kg", quantity: 3200, rate: 115, category: "Reinforcement" }] },
  project_schedule: { project: "Example: foundation to plinth", startDate: "2026-10-01", weekend: "fri", activities: [{ id: "A", name: "Site clearing and layout", duration: 3 }, { id: "B", name: "Excavation", duration: 5, predecessors: ["A"] }, { id: "C", name: "PCC / blinding", duration: 2, predecessors: ["B"] }, { id: "D", name: "Footing reinforcement and concrete", duration: 7, predecessors: ["C"] }, { id: "E", name: "Column stubs", duration: 4, predecessors: ["D"] }, { id: "F", name: "Backfilling", duration: 3, predecessors: ["E"] }, { id: "G", name: "Plinth / grade beams", duration: 6, predecessors: ["E"] }, { id: "H", name: "Ground floor slab on grade", duration: 4, predecessors: ["F", "G"] }] },
  plan_building: { plot: { shape: "trapezoid", frontWidth: 12, rearWidth: 10, depth: 20, units: "m" }, buildingType: "single_family", storeys: 2, bedrooms: 3, garage: true, roadWidth: 6 },
  stormwater_runoff: { units: "SI", areas: [{ label: "Roofs", area: 0.4, C: 0.95 }, { label: "Paved", area: 0.3, C: 0.9 }, { label: "Lawn", area: 0.5, C: 0.2 }], intensity: 100, returnPeriod: 10 },
  pipe_channel_flow: { mode: "size_pipe", units: "SI", Q: 0.25, slope: 0.005, n: 0.013, purpose: "storm" },
  convert_units: { value: 5, from: "katha", to: "sqft" },
  calculate: { expression: "0.85*25*250*0.8*150/1e3" },
  search_code_clauses: { query: "minimum cover", limit: 5 },
};

export default function CalculatorsPage() {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [output, setOutput] = useState<(ToolOutput & { error?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (t: ToolMeta) => { setSelected(t.name); setValues(defaultValues(t.schema as never, PRESETS[t.name] ?? {})); setOutput(null); };
  useEffect(() => { fetch("/api/tools").then((r) => r.json()).then((t: ToolMeta[]) => { const list = t.filter((x) => x.category !== "drawing" || x.name === "plan_building"); /* draw_* tools are used from the chat */ setTools(list); if (list.length) pick(list[0]); });
  }, []);
  const tool = useMemo(() => tools.find((t) => t.name === selected), [tools, selected]);
  const run = async () => {
    if (!tool) return;
    setBusy(true);
    const res = await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tool.name, input: values }) });
    setOutput(await res.json());
    setBusy(false);
  };
  const grouped = useMemo(() => { const g: Record<string, ToolMeta[]> = {}; for (const t of tools) (g[t.category] ??= []).push(t); return g; }, [tools]);
  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 border-r border-border overflow-y-auto p-2 hidden md:block">
        {Object.entries(grouped).map(([cat, list]) => { const c = CAT_COLOR[cat] ?? FALLBACK_COLOR; return (
          <div key={cat} className="mb-3">
            <div className={`flex items-center gap-2 px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide ${c.text}`}><span className={`h-2 w-2 rounded-full ${c.dot}`} />{CATS[cat] ?? cat}</div>
            {list.map((t) => <button key={t.name} className={`w-full text-left rounded-lg border-l-2 px-2 py-1.5 text-sm ${selected === t.name ? `${c.active} text-fg font-medium` : "border-transparent hover:bg-elev2 text-muted"}`} onClick={() => pick(t)}>{toolLabel(t.name)}</button>)}
          </div>); })}
      </aside>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 grid gap-4">
          <div className="md:hidden">
            <select className="select" value={selected} onChange={(e) => { const t = tools.find((x) => x.name === e.target.value); if (t) pick(t); }}>{Object.entries(grouped).map(([cat, list]) => <optgroup key={cat} label={CATS[cat] ?? cat}>{list.map((t) => <option key={t.name} value={t.name}>{toolLabel(t.name)}</option>)}</optgroup>)}</select>
          </div>
          {tool && (
            <>
              <div>
                <h1 className="text-lg font-semibold capitalize">{tool.name.replace(/_/g, " ")}</h1>
                <p className="text-sm text-muted">{tool.description}</p>
              </div>
              <div className="card p-4">
                <SchemaForm key={tool.name} schema={tool.schema as never} values={values} onChange={setValues} />
                <div className="mt-4 flex gap-2">
                  <button className="btn btn-primary" onClick={run} disabled={busy}><Play size={15} /> {busy ? "Running…" : "Calculate"}</button>
                  <button className="btn" onClick={() => pick(tool)}>Reset</button>
                </div>
              </div>
              {output && <ToolCard name={tool.name} args={values} output={output} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
