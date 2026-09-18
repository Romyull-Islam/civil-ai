"use client";
import { useCallback, useEffect, useState } from "react";
import { Cpu, Download, Play, Square, Check, AlertTriangle, RefreshCw } from "lucide-react";

interface Status {
  enabled: boolean;
  hardware: { platform: string; arch: string; cpuModel: string; cores: number; ramGB: number; gpu: { vendor: string; name?: string; vramGB?: number } };
  recommended: string;
  catalog: { id: string; label: string; sizeGB: number; minRamGB: number; params: string; note: string; vision?: boolean; advanced?: boolean; license: string; installed: boolean; fits: boolean }[];
  binaryInstalled: boolean;
  activeModel?: string;
  running: { modelId?: string; port: number } | null;
  progress: { phase: string; file?: string; received: number; total: number; message?: string };
  log: string;
  entitled?: boolean;
  entitlementReason?: string;
}

const gb = (b: number) => (b / 1e9).toFixed(2);

export function LocalAI({ compact = false }: { compact?: boolean }) {
  const [st, setSt] = useState<Status | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const refresh = useCallback(async () => { try { const r = await fetch("/api/local"); const j = (await r.json()) as Status; setSt(j); setChoice((c) => c || j.activeModel || j.recommended); } catch { /* hosted */ } }, []);
  useEffect(() => { let alive = true; fetch("/api/local").then((r) => r.json()).then((j: Status) => { if (!alive) return; setSt(j); setChoice((c) => c || j.activeModel || j.recommended); }).catch(() => {}); return () => { alive = false; }; }, []);
  const busy = st?.progress.phase === "binary" || st?.progress.phase === "model" || st?.progress.phase === "extract";
  useEffect(() => { if (!busy) return; const t = setInterval(refresh, 1000); return () => clearInterval(t); }, [busy, refresh]);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setErr(null);
    const r = await fetch("/api/local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const j = await r.json();
    if (j.error) setErr(j.error);
    setTimeout(refresh, 500);
  };
  if (!st || !st.enabled) return compact ? null : <div className="card p-4 text-sm text-muted">Local AI is available in the desktop app and when running the server on your own machine.</div>;
  const model = st.catalog.find((m) => m.id === choice);
  const pct = st.progress.total ? Math.round((100 * st.progress.received) / st.progress.total) : 0;
  const hwLine = `${st.hardware.cpuModel.replace(/\s+/g, " ").trim()} · ${st.hardware.cores} threads · ${st.hardware.ramGB} GB RAM · GPU: ${st.hardware.gpu.vendor === "none" ? "none (CPU mode)" : `${st.hardware.gpu.name ?? st.hardware.gpu.vendor}${st.hardware.gpu.vramGB ? ` ${st.hardware.gpu.vramGB} GB` : ""}`}`;

  if (st.entitled === false) {
    return <div className={compact ? "card p-3 text-sm flex items-start gap-3" : "card p-4 text-sm flex items-start gap-3"} id="local"><Cpu size={18} className="text-accent shrink-0 mt-0.5" /><div><div className="font-medium">Offline model (Pro feature)</div><div className="text-xs text-muted">{st.entitlementReason}</div></div></div>;
  }
  if (compact) {
    if (st.running && !busy) return null;
    return (
      <div className="card p-3 text-sm flex flex-wrap items-center gap-3">
        <Cpu size={18} className="text-accent shrink-0" />
        <div className="flex-1 min-w-48">
          <div className="font-medium">Set up the built-in offline model, free and unlimited</div>
          <div className="text-xs text-muted">{busy ? `${st.progress.phase === "model" ? "Downloading model" : st.progress.phase === "binary" ? "Downloading engine" : "Extracting"} ${st.progress.file ?? ""} ${pct}% (${gb(st.progress.received)} / ${gb(st.progress.total)} GB)` : `Recommended for this PC: ${st.catalog.find((m) => m.id === st.recommended)?.label} (${st.catalog.find((m) => m.id === st.recommended)?.sizeGB} GB download)`}</div>
        </div>
        {busy ? <div className="w-32 h-2 bg-elev2 rounded overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div> : st.activeModel && st.binaryInstalled ? <button className="btn btn-sm" onClick={() => act("start")}><Play size={14} /> Start</button> : <button className="btn btn-primary btn-sm" onClick={() => act("setup", { modelId: st.recommended })}><Download size={14} /> Install</button>}
      </div>
    );
  }

  return (
    <div className="card p-4 grid gap-3" id="local">
      <div className="flex items-center gap-2"><Cpu className="text-accent" size={18} /><h2 className="font-medium">Local AI (offline, unlimited)</h2>
        {st.running ? <span className="badge text-ok border-ok/40 flex items-center gap-1"><Check size={12} /> running · {st.running.modelId} · port {st.running.port}</span> : <span className="badge">stopped</span>}
        <button className="btn btn-sm ml-auto" onClick={refresh}><RefreshCw size={13} /></button></div>
      <p className="text-xs text-muted">The app downloads a small engine (llama.cpp, 16–30 MB) and a quantized model once (default Qwen 3.5 4B, 2.7 GB; smaller on low-RAM PCs), then runs it on this computer. No API key, no daily limits, no data leaves your machine. Cloud models are still used first in <b>auto</b> mode because they are stronger; choose <b>Local first</b> as provider to prefer this one.</p>
      <div className="text-xs"><span className="label">This computer</span><div className="mt-0.5">{hwLine}</div></div>
      <div className="grid gap-2">
        {st.catalog.filter((m) => !m.advanced || showAdvanced || m.installed || m.id === choice).map((m) => (
          <label key={m.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer ${choice === m.id ? "border-accent2" : "border-border"} ${!m.fits ? "opacity-50" : ""}`}>
            <input type="radio" name="localmodel" className="mt-1" checked={choice === m.id} onChange={() => setChoice(m.id)} disabled={busy} />
            <div className="flex-1 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{m.label}</span><span className="badge">{m.sizeGB} GB</span><span className="badge">needs {m.minRamGB} GB RAM</span>{m.vision && <span className="badge">vision</span>}<span className="badge" title="Licence: free for commercial use">{m.license}</span>{m.id === st.recommended && <span className="badge text-ok border-ok/40">recommended</span>}{m.installed && <span className="badge text-ok border-ok/40">installed</span>}{!m.fits && <span className="badge text-err border-err/40">too big for this PC</span>}</div>
              <div className="text-xs text-muted">{m.note}</div>
            </div>
          </label>
        ))}
        {!showAdvanced && <button className="text-xs text-muted hover:text-fg text-left" onClick={() => setShowAdvanced(true)}>Show advanced models (9B+, slow without a strong GPU)…</button>}
      </div>
      {busy && (
        <div className="grid gap-1 text-xs">
          <div>{st.progress.phase === "model" ? "Downloading model" : st.progress.phase === "binary" ? "Downloading engine" : "Extracting"} {st.progress.file}: {pct}% ({gb(st.progress.received)} / {gb(st.progress.total)} GB){st.progress.message ? ` · ${st.progress.message}` : ""}</div>
          <div className="w-full h-2 bg-elev2 rounded overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {st.progress.phase === "error" && <div className="text-xs text-err flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{st.progress.message}</div>}
      {err && <div className="text-xs text-err">{err}</div>}
      <div className="flex flex-wrap gap-2">
        {busy ? <button className="btn" onClick={() => act("cancel")}><Square size={14} /> Cancel</button> : (
          <>
            <button className="btn btn-primary" disabled={!model || !model.fits} onClick={() => act("setup", { modelId: choice })}><Download size={14} /> {model?.installed && st.binaryInstalled ? "Use this model" : `Download & install (${model?.sizeGB ?? "?"} GB)`}</button>
            {st.running ? <button className="btn" onClick={() => act("stop")}><Square size={14} /> Stop</button> : st.activeModel && st.binaryInstalled ? <button className="btn" onClick={() => act("start")}><Play size={14} /> Start</button> : null}
          </>
        )}
      </div>
      {st.log && <details className="text-xs text-muted"><summary className="cursor-pointer">engine log</summary><pre className="mt-1 p-2 bg-elev2 rounded overflow-x-auto max-h-40">{st.log}</pre></details>}
    </div>
  );
}
