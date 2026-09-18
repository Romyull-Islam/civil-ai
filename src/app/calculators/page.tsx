"use client";
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { SchemaForm, defaultValues } from "@/components/SchemaForm";
import { ToolCard } from "@/components/ToolCard";
import type { ToolOutput } from "@/lib/tools";

interface ToolMeta { name: string; category: string; description: string; schema: Record<string, unknown> }
const CATS: Record<string, string> = { analysis: "Analysis", design: "Design", geotech: "Geotechnical", quantities: "Quantities & BOQ", utility: "Utilities", reference: "Reference", drawing: "Drawings" };

const PRESETS: Record<string, Record<string, unknown>> = {
  analyze_beam: { span: 6, support: "simply_supported", loads: [{ type: "udl", magnitude: 20 }], E: 200000, section: { b: 300, h: 500 } },
  design_rc_beam: { code: "IS456", b: 300, D: 500, cover: 25, fck: 25, fy: 500, Mu: 150, Vu: 120, stirrupDia: 8, mainBarDia: 16 },
  design_rc_column: { code: "IS456", b: 300, D: 450, fck: 25, fy: 500, Pu: 1800, unsupportedLength: 3000 },
  design_one_way_slab: { code: "IS456", span: 3.5, liveLoad: 3, floorFinish: 1, fck: 25, fy: 500, cover: 20, support: "simply_supported" },
  design_isolated_footing: { code: "IS456", columnB: 400, columnD: 400, serviceLoad: 900, safeBearingCapacity: 180, fck: 25, fy: 500, cover: 50 },
  design_steel_beam: { code: "IS800", span: 6, factoredUDL: 30, serviceUDL: 20 },
  bearing_capacity: { cohesion: 10, frictionAngle: 30, unitWeight: 18, depth: 1.5, width: 2, shape: "square", factorOfSafety: 3 },
  concrete_materials: { volume: 10, grade: "M20", wastagePercent: 3 },
  rebar_schedule: { items: [{ label: "Bottom bars", diameter: 16, length: 6.3, count: 4 }, { label: "Stirrups", diameter: 8, length: 1.5, count: 40 }], wastagePercent: 3 },
  convert_units: { value: 1, from: "kN/m2", to: "psf" },
  calculate: { expression: "0.36*25*300*0.46*450*(450-0.42*0.46*450)/1e6" },
  search_code_clauses: { query: "minimum cover", limit: 5 },
};

export default function CalculatorsPage() {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [output, setOutput] = useState<(ToolOutput & { error?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (t: ToolMeta) => { setSelected(t.name); setValues(defaultValues(t.schema as never, PRESETS[t.name] ?? {})); setOutput(null); };
  useEffect(() => { fetch("/api/tools").then((r) => r.json()).then((t: ToolMeta[]) => { const list = t.filter((x) => x.category !== "drawing"); setTools(list); if (list.length) pick(list[0]); });
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
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="mb-3">
            <div className="label px-2 mb-1">{CATS[cat] ?? cat}</div>
            {list.map((t) => <button key={t.name} className={`w-full text-left rounded-lg px-2 py-1.5 text-sm ${selected === t.name ? "bg-elev2" : "hover:bg-elev2 text-muted"}`} onClick={() => pick(t)}>{t.name.replace(/_/g, " ")}</button>)}
          </div>
        ))}
      </aside>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 grid gap-4">
          <div className="md:hidden">
            <select className="select" value={selected} onChange={(e) => { const t = tools.find((x) => x.name === e.target.value); if (t) pick(t); }}>{tools.map((t) => <option key={t.name} value={t.name}>{t.name.replace(/_/g, " ")}</option>)}</select>
          </div>
          {tool && (
            <>
              <div>
                <h1 className="text-lg font-semibold capitalize">{tool.name.replace(/_/g, " ")}</h1>
                <p className="text-sm text-muted">{tool.description}</p>
              </div>
              <div className="card p-4">
                <SchemaForm schema={tool.schema as never} values={values} onChange={setValues} />
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
