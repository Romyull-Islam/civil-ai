"use client";
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { SchemaForm, defaultValues } from "@/components/SchemaForm";
import { ToolCard } from "@/components/ToolCard";
import type { ToolOutput } from "@/lib/tools";
import { useSettings, saveSettings, loadSettings, COUNTRY_PRESETS } from "@/lib/client/settings";

type Region = "BD" | "US";
/** US starting values in US units (in, ft, psi, ksi, kip, kip-ft, psf, pcf; bars as numbers, 6 = #6). */
const PRESETS_US: Record<string, Record<string, unknown>> = {
  design_rc_beam: { units: "US", code: "ACI318", b: 12, D: 20, fck: 4000, fy: 60, Mu: 118, Vu: 25, mainBarDia: 6, span: 20, support: "one_end_continuous" },
  rc_beam_capacity: { units: "US", code: "ACI318", b: 12, d: 17.5, bars: { count: 3, dia: 9 }, fck: 4000, fy: 60 },
  design_rc_column: { units: "US", code: "ACI318", b: 16, D: 16, fck: 4000, fy: 60, Pu: 340, Mux: 60, Muy: 20, unsupportedLength: 12, curvature: "double", endMomentRatio: 0.5 },
  design_one_way_slab: { units: "US", code: "ACI318", span: 12, liveLoad: 40, floorFinish: 15, fck: 4000, fy: 60, support: "one_end_continuous" },
  design_isolated_footing: { units: "US", code: "ACI318", columnB: 16, columnD: 16, deadLoad: 150, liveLoad: 80, safeBearingCapacity: 3, fck: 4000, fy: 60 },
  design_steel_beam: { units: "US", code: "AISC", span: 24, factoredUDL: 2.0, serviceUDL: 1.3, unbracedLength: 8 },
  bearing_capacity: { units: "US", cohesion: 0, frictionAngle: 30, unitWeight: 115, depth: 5, width: 6, shape: "square", factorOfSafety: 3 },
  earth_pressure: { units: "US", frictionAngle: 30, height: 12, unitWeight: 120, surcharge: 250 },
  mix_design_aci: { units: "US", code: "ACI318", fc: 4000, slump: 4, nms: 0.75, fm: 2.7, caDryRoddedDensity: 100, caSG: 2.68, faSG: 2.64, caAbsorption: 0.5, faAbsorption: 0.7, caMoisture: 2, faMoisture: 6 },
  plan_building: { plot: { shape: "rectangular", width: 60, depth: 110, units: "ft" }, buildingType: "single_family", storeys: 2, bedrooms: 3, bathrooms: 2, garage: true, dining: true, standard: "IRC2021" },
  stormwater_runoff: { units: "US", areas: [{ label: "Roofs", area: 1.0, C: 0.95 }, { label: "Paved", area: 0.75, C: 0.9 }, { label: "Lawn", area: 1.25, C: 0.2 }], intensity: 4, returnPeriod: 10 },
  pipe_channel_flow: { mode: "size_pipe", units: "US", Q: 9, slope: 0.005, n: 0.013, purpose: "storm" },
  cost_estimate: { project: "Example: house foundation", currency: "USD", rateSource: "EXAMPLE RATES ONLY: replace with your bids or cost data", overheadPercent: 8, profitPercent: 10, items: [{ description: "Excavation", unit: "cy", quantity: 160, rate: 12, category: "Earthwork" }, { description: "Footing concrete, 4000 psi", unit: "cy", quantity: 50, rate: 185, category: "Concrete" }, { description: "Rebar, Grade 60, placed", unit: "lb", quantity: 7000, rate: 1.1, category: "Reinforcement" }] },
};
/** Region-dependent choices every calculator exposes (code, standard, units, weekend, currency). */
function regionize(schema: Record<string, unknown>, values: Record<string, unknown>, region: Region): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, { enum?: unknown[] }>;
  const out = { ...values };
  const pick = (k: string, us: string[], bd: string[]) => { const e = props[k]?.enum; if (!e || (values[k] !== undefined && region === "BD")) return; const hit = (region === "US" ? us : bd).find((x) => e.includes(x)); if (hit) out[k] = hit; };
  pick("code", ["ACI318", "AISC"], ["BNBC2020", "IS800"]);
  pick("standard", ["AASHTO", "IRC2021"], ["RHD", "BNBC2020"]);
  pick("units", ["US", "ft"], ["SI", "m"]);
  pick("weekend", ["sat_sun"], ["fri"]);
  pick("currency", ["USD"], ["BDT"]);
  return out;
}

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
  rc_beam_capacity: { code: "BNBC2020", b: 250, d: 400, bars: { count: 3, dia: 16 }, fck: 25, fy: 500 },
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

/** Starting values for a calculator in a region: that region's example, then its code / standard / units. */
const seedFor = (t: ToolMeta, r: Region) => regionize(t.schema, r === "US" ? PRESETS_US[t.name] ?? PRESETS[t.name] ?? {} : PRESETS[t.name] ?? {}, r);

export default function CalculatorsPage() {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [output, setOutput] = useState<(ToolOutput & { error?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = useSettings();
  const region: Region = settings.preferences.country === "US" ? "US" : "BD";
  const pick = (t: ToolMeta, r: Region = region) => { setSelected(t.name); setValues(defaultValues(t.schema as never, seedFor(t, r))); setOutput(null); };
  const setRegion = (r: Region) => { saveSettings({ ...settings, preferences: { ...settings.preferences, ...COUNTRY_PRESETS[r] } }); const t = tools.find((x) => x.name === selected); if (t) pick(t, r); };
  useEffect(() => {
    fetch("/api/tools").then((r) => r.json()).then((t: ToolMeta[]) => {
      const list = t.filter((x) => x.category !== "drawing" || x.name === "plan_building"); // draw_* tools are used from the chat
      setTools(list);
      const first = list[0];
      if (first) { setSelected(first.name); setValues(defaultValues(first.schema as never, seedFor(first, loadSettings().preferences.country === "US" ? "US" : "BD"))); }
    });
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
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Region:</span>
            {(["BD", "US"] as Region[]).map((r) => <button key={r} className={`btn btn-sm ${region === r ? "btn-primary" : ""}`} onClick={() => setRegion(r)}>{r === "BD" ? "Bangladesh (BNBC, RHD, SI)" : "USA (ACI, AISC, AASHTO, US units)"}</button>)}
            {region === "US" && <span className="text-[11px] text-muted w-full">US units: in, ft, psi (f&apos;c), ksi (fy), kip, kip-ft, psf, pcf; bars #3 to #11 are entered as numbers (6 = #6). Drawings download in inches.</span>}
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
