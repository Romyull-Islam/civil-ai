"use client";
import { useState } from "react";
import { Cloud, LogOut } from "lucide-react";
import { useSession, refreshSession } from "@/lib/client/session";

/** Desktop / self-hosted: link the app to a hosted CivilMate account so cloud models come from your subscription. */
export function CloudAccount() {
  const session = useSession();
  const [url, setUrl] = useState(process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL ?? "");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const c = session?.cloud;
  const link = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/cloud/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backendUrl: url, email, password: pw }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error); return; }
    setPw(""); refreshSession();
  };
  const unlink = async () => { await fetch("/api/cloud/logout", { method: "POST" }); refreshSession(); };
  return (
    <section className="card p-4 grid gap-3">
      <div className="flex items-center gap-2"><Cloud className="text-accent" size={18} /><h2 className="font-medium">CivilMate cloud account (better models)</h2>{c?.linked && <span className="badge text-ok border-ok/40">linked · {c.email}{c.plan?.name ? ` · ${c.plan.name}` : ""}</span>}</div>
      <p className="text-xs text-muted">The local model works offline and is unlimited. For harder design questions, sign in to your CivilMate subscription: cloud models are then available in the model selector and answered by the service with its own API keys. No keys to manage.</p>
      {c?.linked ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{c.backendUrl}</span>{c.offline && <span className="badge text-err border-err/40">offline</span>}
          {c.usage?.limit != null && <span className="text-muted">{c.usage.remaining} of {c.usage.limit} cloud requests left today</span>}
          <button className="btn btn-sm" onClick={unlink}><LogOut size={13} /> Unlink</button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-3 gap-2">
          <input className="input" placeholder="https://your-civil-ai.vercel.app" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input" placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex gap-1"><input className="input" placeholder="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /><button className="btn btn-primary" onClick={link} disabled={busy || !url || !email || !pw}>Link</button></div>
          {err && <div className="text-xs text-err sm:col-span-3">{err}</div>}
        </div>
      )}
    </section>
  );
}
