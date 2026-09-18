"use client";
import { useEffect, useState } from "react";
import { CreditCard, Check } from "lucide-react";
import { useSession } from "@/lib/client/session";

interface SiteInfo { gateways: { id: string; label: string; methods: string; sandbox: boolean }[]; site: { payment: { bkash: string; nagad: string; rocket: string; bank: string; qrImage: string; note: string; currency: string; conversion: number }; supportEmail: string; whatsapp: string }; plans: { id: string; name: string; priceMonthly: number; currency: string; periodDays: number; features: string[] }[] }

// eslint-disable-next-line @next/next/no-img-element
const QrImage = ({ src, className }: { src: string; className: string }) => <img src={src} alt="Bangla QR" className={className} />;

export default function SubscribePage() {
  const s = useSession();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [planId, setPlanId] = useState(""); const [method, setMethod] = useState("bkash"); const [txn, setTxn] = useState(""); const [sender, setSender] = useState("");
  const [done, setDone] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const payOnline = async (gateway: string) => { setErr(null); setPaying(gateway); const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, gateway }) }); const j = await r.json(); setPaying(null); if (!r.ok) { setErr(j.error); return; } window.location.assign(j.url); };
  const [mine, setMine] = useState<{ id: string; plan: string; method: string; txnId: string; status: string; createdAt: number; note: string }[]>([]);
  useEffect(() => { fetch("/api/site").then((r) => r.json()).then((j: SiteInfo) => { setInfo(j); const q = new URLSearchParams(window.location.search).get("plan"); setPlanId(q && j.plans.some((p) => p.id === q) ? q : j.plans.find((p) => p.priceMonthly > 0)?.id ?? ""); }); fetch("/api/payments").then((r) => r.json()).then((j) => setMine(j.payments ?? [])).catch(() => {}); }, []);
  if (!info) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (!s?.user) return <div className="p-6 text-sm">Please <a className="text-accent2" href="/login?next=/subscribe">sign in</a> to subscribe.</div>;
  const plan = info.plans.find((p) => p.id === planId);
  const pay = info.site.payment;
  const local = plan ? Math.round(plan.priceMonthly * (pay.currency === plan.currency ? 1 : pay.conversion)) : 0;
  const methods = [["bkash", "bKash", pay.bkash], ["nagad", "Nagad", pay.nagad], ["rocket", "Rocket", pay.rocket], ["qr", "Bangla QR", pay.qrImage ? "scan the QR" : ""], ["bank", "Bank transfer", pay.bank]].filter(([, , v]) => v) as [string, string, string][];
  const submit = async () => {
    setErr(null);
    const r = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, method, amount: local, currency: pay.currency, txnId: txn, sender }) });
    const j = await r.json(); if (!r.ok) { setErr(j.error); return; }
    setDone(j.payment.id); setMine((m) => [j.payment, ...m]);
  };
  return (
    <div className="h-full overflow-y-auto"><div className="max-w-3xl mx-auto p-6 grid gap-4">
      <div className="flex items-center gap-2"><CreditCard className="text-accent" /><h1 className="text-lg font-semibold">Subscribe</h1></div>
      <div className="grid sm:grid-cols-3 gap-2">{info.plans.filter((p) => p.priceMonthly > 0).map((p) => <button key={p.id} className={`card p-3 text-left ${planId === p.id ? "border-accent" : ""}`} onClick={() => setPlanId(p.id)}><div className="font-medium">{p.name}</div><div className="text-sm text-muted">{p.currency === "BDT" ? "৳" : p.currency + " "}{p.priceMonthly} / {p.periodDays} days{pay.currency !== p.currency ? ` ≈ ${Math.round(p.priceMonthly * pay.conversion)} ${pay.currency}` : ""}</div></button>)}</div>
      {plan && info.gateways.length > 0 && (
        <div className="card p-4 grid gap-2 text-sm">
          <div className="font-medium">Pay online — activated instantly</div>
          <div className="flex flex-wrap gap-2">{info.gateways.map((g) => <button key={g.id} className="btn btn-primary" onClick={() => payOnline(g.id)} disabled={paying !== null}>{paying === g.id ? "Redirecting…" : `${g.label}${g.sandbox ? " (test)" : ""}`}</button>)}</div>
          <div className="text-xs text-muted">{info.gateways.map((g) => `${g.label}: ${g.methods}`).join(" · ")}</div>
          {err && <div className="text-err text-xs">{err}</div>}
        </div>
      )}
      {plan && (
        <div className="card p-4 grid gap-3 text-sm">
          <div className="font-medium">{info.gateways.length ? "Or pay manually" : "Pay"} {local} {pay.currency} for {plan.name} ({plan.periodDays} days)</div>
          {!methods.length && <div className="text-err text-xs">Payment methods are not configured yet. Contact support{info.site.supportEmail ? `: ${info.site.supportEmail}` : ""}.</div>}
          <div className="flex flex-wrap gap-2">{methods.map(([id, label]) => <button key={id} className={`btn btn-sm ${method === id ? "btn-primary" : ""}`} onClick={() => setMethod(id)}>{label}</button>)}</div>
          {method === "qr" && pay.qrImage ? <QrImage src={pay.qrImage} className="w-56 rounded-lg border border-border bg-white p-2" /> : <div className="text-base font-mono">{methods.find(([id]) => id === method)?.[2]}</div>}
          <p className="text-xs text-muted whitespace-pre-wrap">{pay.note}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <div><label className="label">Transaction ID (TrxID)</label><input className="input mt-1" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. 9K7A3B2C1D" /></div>
            <div><label className="label">Sender number / account</label><input className="input mt-1" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="01XXXXXXXXX" /></div>
          </div>
          {err && <div className="text-err text-xs">{err}</div>}
          {done ? <div className="text-ok flex items-center gap-2"><Check size={16} /> Submitted. We will activate your plan after verifying the payment (usually within 24 hours).</div> : <button className="btn btn-primary justify-self-start" onClick={submit} disabled={!txn || !methods.length}>Submit payment</button>}
        </div>
      )}
      {mine.length > 0 && <div className="card p-4 text-sm"><div className="label mb-2">Your payment requests</div><table className="w-full text-xs"><thead><tr className="text-left text-muted"><th>Date</th><th>Plan</th><th>Method</th><th>TrxID</th><th>Status</th></tr></thead><tbody>{mine.map((p) => <tr key={p.id} className="border-t border-border"><td className="py-1">{new Date(p.createdAt).toLocaleDateString()}</td><td>{p.plan}</td><td>{p.method}</td><td className="font-mono">{p.txnId}</td><td>{p.status}{p.note ? ` — ${p.note}` : ""}</td></tr>)}</tbody></table></div>}
    </div></div>
  );
}
