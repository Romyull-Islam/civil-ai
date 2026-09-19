"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench, CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import type { ToolOutput } from "@/lib/tools";
import { tableWorkbook, type WorkbookSpec } from "@/lib/docs/workbook";
import { BeamChart } from "./BeamChart";
import { DrawingViewer } from "./DrawingViewer";

const TITLES: Record<string, string> = {
  analyze_beam: "Beam analysis", design_rc_beam: "RC beam design", design_rc_column: "RC column design", design_one_way_slab: "One-way slab design", design_isolated_footing: "Isolated footing design",
  design_steel_beam: "Steel beam selection", bearing_capacity: "Bearing capacity", earth_pressure: "Earth pressure", concrete_materials: "Concrete materials", rebar_schedule: "Bar bending schedule",
  masonry_and_finishes: "Quantities", earthwork_volume: "Earthwork volume", convert_units: "Unit conversion", calculate: "Calculation", search_code_clauses: "Code clauses",
  horizontal_curve: "Horizontal curve", curve_radius_superelevation: "Radius & superelevation", sight_distance: "Sight distance", vertical_curve: "Vertical curve", road_cross_section: "Road cross-section",
  pavement_flexible_aashto: "Flexible pavement (AASHTO 1993)", pavement_rigid_aashto: "Rigid pavement (AASHTO 1993)", traffic_esal: "Design traffic (ESAL / msa)", pavement_rhd_catalogue: "Pavement (RHD 2005 catalogue)",
  mix_design_aci: "Concrete mix design (ACI 211.1)", mix_design_is10262: "Concrete mix design (IS 10262)", stormwater_runoff: "Stormwater runoff", pipe_channel_flow: "Pipe / channel flow", plan_building: "Building plan",
  cost_estimate: "Cost estimate", project_schedule: "Project schedule (CPM)", settlement: "Settlement",
  draw_beam_section: "Beam section drawing", draw_beam_elevation: "Beam elevation drawing", draw_column_section: "Column section drawing", draw_footing: "Footing drawing", draw_floor_plan: "Floor plan", draw_custom: "Drawing",
};

/** Build the .xlsx on the server (exceljs stays out of the browser bundle) and save it. */
async function downloadXlsx(spec: WorkbookSpec) {
  const res = await fetch("/api/export/xlsx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
  if (!res.ok) { let msg = `${res.status}`; try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ } throw new Error(msg); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `${(spec.title || "civilmate").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "civilmate"}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function ToolCard({ name, args, output, pending }: { name: string; args: Record<string, unknown>; output?: ToolOutput & { error?: string }; pending?: boolean }) {
  const [showArgs, setShowArgs] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const d = output?.display;
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxErr, setXlsxErr] = useState<string | null>(null);
  const workbook: WorkbookSpec | null = output && !output.error ? output.workbook ?? (d?.kind === "table" ? tableWorkbook(d.title ?? TITLES[name] ?? name, d.columns, d.rows) : null) : null;
  const exportXlsx = async () => { if (!workbook) return; setXlsxBusy(true); setXlsxErr(null); try { await downloadXlsx(workbook); } catch (e) { setXlsxErr(`Excel export failed: ${(e as Error).message}`); } finally { setXlsxBusy(false); } };
  return (
    <div className="card my-2 text-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Wrench size={14} className="text-accent" />
        <span className="font-medium">{TITLES[name] ?? name}</span>
        {pending && <span className="typing ml-2"><span /><span /><span /></span>}
        {output?.error && <span className="badge text-err border-err/40">error</span>}
        {workbook && <button className="ml-auto btn btn-sm" onClick={exportXlsx} disabled={xlsxBusy} title="Download as an Excel workbook">{xlsxBusy ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} Excel</button>}
        <button className={`${workbook ? "" : "ml-auto "}text-xs text-muted hover:text-fg flex items-center gap-1`} onClick={() => setShowArgs((v) => !v)}>{showArgs ? <ChevronDown size={12} /> : <ChevronRight size={12} />} inputs</button>
      </div>
      {showArgs && <pre className="text-xs p-3 overflow-x-auto bg-elev2 border-b border-border">{JSON.stringify(args, null, 2)}</pre>}
      {xlsxErr && <div className="px-3 py-2 text-err text-xs">{xlsxErr}</div>}
      {output?.error && <div className="px-3 py-2 text-err flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{output.error}</div>}
      {output?.summary && !output.error && <div className="px-3 py-2 text-fg">{output.summary}</div>}
      {d?.kind === "beam" && <div className="px-3 pb-3"><BeamChart result={d.result} /></div>}
      {d?.kind === "drawing" && <div className="p-3"><DrawingViewer drawing={d.drawing} svg={d.svg} /></div>}
      {d?.kind === "table" && (
        <div className="px-3 pb-3 overflow-x-auto">
          {d.title && <div className="label mb-1">{d.title}</div>}
          <table className="w-full text-xs border-collapse">
            <thead><tr>{d.columns.map((c) => <th key={c} className="text-left border border-border bg-elev2 px-2 py-1">{c}</th>)}</tr></thead>
            <tbody>{d.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-border px-2 py-1 align-top">{String(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {d?.kind === "steps" && (
        <div className="px-3 pb-3 grid gap-2">
          {d.title && <div className="label">{d.title}</div>}
          <ol className="list-decimal ml-5 text-xs grid gap-1 text-muted">{d.steps.map((s, i) => <li key={i} className="font-mono">{s}</li>)}</ol>
          {d.checks?.length ? (
            <div className="grid gap-1 mt-1">
              {d.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">{c.ok ? <CheckCircle2 size={14} className="text-ok mt-0.5 shrink-0" /> : <XCircle size={14} className="text-err mt-0.5 shrink-0" />}<span><b>{c.name}:</b> {c.detail}</span></div>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {output && !output.error && (
        <div className="px-3 pb-2">
          <button className="text-xs text-muted hover:text-fg" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "hide" : "show"} raw result</button>
          {showRaw && <pre className="text-xs mt-1 p-2 overflow-x-auto bg-elev2 rounded max-h-72">{JSON.stringify(output.result, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
