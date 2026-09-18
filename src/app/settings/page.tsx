"use client";
import { useEffect, useState } from "react";
import { Settings as SettingsIcon, RefreshCw, ExternalLink, Check, Eye, EyeOff } from "lucide-react";
import { PROVIDERS, AUTO_CHAIN } from "@/lib/ai/registry";
import { LocalAI } from "@/components/LocalAI";
import { CloudAccount } from "@/components/CloudAccount";
import { useSettings, saveSettings, type AppSettings } from "@/lib/client/settings";
import { useSession } from "@/lib/client/session";

export default function SettingsPage() {
  const s = useSettings();
  const session = useSession();
  const saas = session?.mode === "saas";
  const byok = session?.mode === "byok";
  const [envConfigured, setEnvConfigured] = useState<string[]>([]);
  const [live, setLive] = useState<Record<string, string[] | string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then((j) => setEnvConfigured(j.providersFromEnv ?? [])).catch(() => {}); }, []);
  const update = (patch: Partial<AppSettings>) => { saveSettings({ ...s, ...patch }); setSaved(true); setTimeout(() => setSaved(false), 1200); };
  const setKey = (id: string, patch: { apiKey?: string; baseUrl?: string; model?: string }) => update({ keys: { ...s.keys, [id]: { ...s.keys[id], ...patch } } });
  const fetchModels = async (id: string) => {
    setLive((l) => ({ ...l, [id]: "loading…" }));
    const r = await fetch("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id, keys: s.keys }) });
    const j = await r.json();
    setLive((l) => ({ ...l, [id]: j.error ? `error: ${j.error}` : (j.models as string[]) }));
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 grid gap-5">
        <div className="flex items-center gap-2"><SettingsIcon className="text-accent" /><h1 className="text-lg font-semibold">Settings</h1>{saved && <span className="text-xs text-ok flex items-center gap-1"><Check size={14} /> saved</span>}</div>

        {byok && <section className="card p-4 grid gap-3">
          <h2 className="font-medium">AI provider</h2>
          <p className="text-xs text-muted">Keys are stored only in this browser/app (localStorage) and sent with each request to your own server. Server-side keys in <code>.env.local</code> are used when a field is empty. <b>auto</b> tries free tiers first: {AUTO_CHAIN.join(" → ")}.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Provider</label>
              <select className="select mt-1" value={s.provider} onChange={(e) => update({ provider: e.target.value, model: undefined })}>
                <option value="auto">Auto (free cloud tiers first, then local, fallback on limits)</option>
                <option value="local-first">Local first (offline model, cloud only as fallback)</option>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select></div>
            {s.provider !== "auto" && <div><label className="label">Model</label>
              <input className="input mt-1" list={`models-${s.provider}`} value={s.model ?? ""} placeholder={PROVIDERS.find((p) => p.id === s.provider)?.models[0]?.id} onChange={(e) => update({ model: e.target.value || undefined })} />
              <datalist id={`models-${s.provider}`}>{PROVIDERS.find((p) => p.id === s.provider)?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}{Array.isArray(live[s.provider]) && (live[s.provider] as string[]).map((m) => <option key={m} value={m} />)}</datalist></div>}
          </div>
        </section>}

        {!saas && <LocalAI />}
        {!saas && <CloudAccount />}

        {saas && <section className="card p-4 text-sm"><h2 className="font-medium">Your plan</h2><p className="text-muted mt-1">Models and daily limits come from your subscription ({session?.plan?.name}). Pick a model from the selector under the chat box. Manage your account on the <a className="text-accent2" href="/account">Account</a> page.</p></section>}

        {byok && <section className="grid gap-3">
          <h2 className="font-medium">API keys</h2>
          {PROVIDERS.map((p) => {
            const k = s.keys[p.id] ?? {};
            const fromEnv = envConfigured.includes(p.id);
            return (
              <div key={p.id} className="card p-4 grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.label}</span>
                  {p.models.some((m) => m.free) && <span className="badge text-ok border-ok/40">free tier</span>}
                  {fromEnv && <span className="badge">key from server env</span>}
                  {k.apiKey && <span className="badge text-ok border-ok/40">key set</span>}
                  <a className="ml-auto text-xs text-accent2 flex items-center gap-1" href={p.keyUrl} target="_blank" rel="noreferrer">get key <ExternalLink size={12} /></a>
                </div>
                <p className="text-xs text-muted">{p.freeTier}</p>
                <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                  {p.requiresKey ? (
                    <div><label className="label">API key</label>
                      <div className="flex gap-1 mt-1">
                        <input className="input" type={show[p.id] ? "text" : "password"} value={k.apiKey ?? ""} placeholder={fromEnv ? "(using server key)" : "paste key"} onChange={(e) => setKey(p.id, { apiKey: e.target.value })} autoComplete="off" />
                        <button className="btn" onClick={() => setShow((v) => ({ ...v, [p.id]: !v[p.id] }))} aria-label="toggle">{show[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                      </div></div>
                  ) : <div className="text-xs text-muted self-center">No key needed — runs locally.</div>}
                  <button className="btn btn-sm" onClick={() => fetchModels(p.id)}><RefreshCw size={13} /> list live models</button>
                </div>
                {(p.baseUrlEnv || p.baseUrl) && (
                  <div><label className="label">Base URL</label><input className="input mt-1" value={k.baseUrl ?? ""} placeholder={p.baseUrl ?? "https://…/v1"} onChange={(e) => setKey(p.id, { baseUrl: e.target.value })} /></div>
                )}
                <div><label className="label">Preferred model for auto mode</label>
                  <input className="input mt-1" list={`auto-models-${p.id}`} value={k.model ?? ""} placeholder={p.models[0]?.id} onChange={(e) => setKey(p.id, { model: e.target.value })} />
                  <datalist id={`auto-models-${p.id}`}>{p.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.note ? ` — ${m.note}` : ""}</option>)}{Array.isArray(live[p.id]) && (live[p.id] as string[]).map((m) => <option key={m} value={m} />)}</datalist>
                </div>
                {typeof live[p.id] === "string" && <div className="text-xs text-muted">{live[p.id] as string}</div>}
                {Array.isArray(live[p.id]) && <div className="text-xs text-muted max-h-24 overflow-y-auto">{(live[p.id] as string[]).length} models: {(live[p.id] as string[]).join(", ")}</div>}
              </div>
            );
          })}
        </section>}

        <section className="card p-4 grid gap-3">
          <h2 className="font-medium">Engineering preferences</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Default design code</label>
              <select className="select mt-1" value={s.preferences.designCode ?? ""} onChange={(e) => update({ preferences: { ...s.preferences, designCode: e.target.value } })}>
                {["IS 456 / IS 800", "ACI 318 / AISC 360", "Eurocode 2 / Eurocode 3", "BS 8110 / BS 5950", "AS 3600 / AS 4100"].map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div><label className="label">Units</label>
              <select className="select mt-1" value={s.preferences.units ?? "SI"} onChange={(e) => update({ preferences: { ...s.preferences, units: e.target.value as "SI" | "imperial" } })}><option value="SI">SI (kN, m, MPa)</option><option value="imperial">Imperial (kip, ft, psi)</option></select></div>
            <div><label className="label">Region / jurisdiction</label><input className="input mt-1" value={s.preferences.region ?? ""} placeholder="e.g. Dhaka, Bangladesh" onChange={(e) => update({ preferences: { ...s.preferences, region: e.target.value } })} /></div>
            <div><label className="label">Your name (optional)</label><input className="input mt-1" value={s.preferences.name ?? ""} onChange={(e) => update({ preferences: { ...s.preferences, name: e.target.value } })} /></div>
            <div><label className="label">Theme</label>
              <select className="select mt-1" value={s.theme} onChange={(e) => update({ theme: e.target.value as AppSettings["theme"] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></div>
          </div>
        </section>
      </div>
    </div>
  );
}
