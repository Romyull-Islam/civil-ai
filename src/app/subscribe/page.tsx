"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, ShieldCheck, Zap, Check, ChevronDown, ChevronUp, Lock } from "lucide-react";
import { useSession } from "@/lib/client/session";

interface SiteInfo {
  gateways: { id: string; label: string; methods: string; sandbox: boolean }[];
  site: { appName: string; payment: { bkash: string; nagad: string; rocket: string; bank: string; qrImage: string; note: string; currency: string; conversion: number }; supportEmail: string; whatsapp: string };
  plans: { id: string; name: string; priceMonthly: number; currency: string; periodDays: number; features: string[]; monthlyCredits: number; dailyCredits: number; perSeat?: boolean; minSeats?: number }[];
}
const METHODS = ["Visa", "Mastercard", "Amex", "bKash", "Nagad", "Rocket", "Upay", "Bangla QR", "Internet banking"];
const cur = (c: string) => (c === "BDT" ? "৳" : c === "USD" ? "$" : c + " ");
// eslint-disable-next-line @next/next/no-img-element
const QrImage = ({ src }: { src: string }) => <img src={src} alt="Bangla QR" className="w-48 rounded-lg border border-border bg-white p-2" />;

export default function SubscribePage() {
  const s = useSession();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [planId, setPlanId] = useState("");
  const [seats, setSeats] = useState(3);
  const [paying, setPaying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [method, setMethod] = useState("bkash"); const [txn, setTxn] = useState(""); const [sender, setSender] = useState(""); const [done, setDone] = useState(false);
  const [mine, setMine] = useState<{ id: string; plan: string; method: string; txnId: string; status: string; createdAt: number; note: string; amount: number; currency: string }[]>([]);

  useEffect(() => {
    fetch("/api/site").then((r) => r.json()).then((j: SiteInfo) => { setInfo(j); const q = new URLSearchParams(window.location.search).get("plan"); setPlanId(q && j.plans.some((p) => p.id === q) ? q : j.plans.find((p) => p.priceMonthly > 0)?.id ?? ""); });
    fetch("/api/payments").then((r) => r.json()).then((j) => setMine(j.payments ?? [])).catch(() => {});
  }, []);
  if (!info) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (!s?.user) return <div className="p-6 text-sm">Please <Link className="text-accent2" href="/login?next=/subscribe">sign in</Link> to subscribe.</div>;

  const plan = info.plans.find((p) => p.id === planId);
  const pay = info.site.payment;
  const nSeats = plan?.perSeat ? Math.max(plan.minSeats ?? 1, seats) : 1;
  const unit = plan ? Math.round(plan.priceMonthly * (pay.currency === plan.currency ? 1 : pay.conversion)) : 0;
  const total = unit * nSeats;
  const primary = info.gateways.find((g) => g.id === "sslcommerz") ?? info.gateways.find((g) => g.id !== "stripe") ?? null;
  const others = info.gateways.filter((g) => g.id !== primary?.id);
  const manualMethods = ([["bkash", "bKash", pay.bkash], ["nagad", "Nagad", pay.nagad], ["rocket", "Rocket", pay.rocket], ["qr", "Bangla QR", pay.qrImage ? "scan the QR" : ""], ["bank", "Bank transfer", pay.bank]] as [string, string, string][]).filter(([, , v]) => v);

  const payOnline = async (gateway: string) => {
    setErr(null); setPaying(gateway);
    const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, gateway, seats: nSeats }) });
    const j = await r.json(); setPaying(null);
    if (!r.ok) { setErr(j.error); return; }
    window.location.assign(j.url);
  };
  const submitManual = async () => {
    setErr(null);
    const r = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, method, amount: total, currency: pay.currency, txnId: txn, sender, seats: nSeats }) });
    const j = await r.json(); if (!r.ok) { setErr(j.error); return; }
    setDone(true); setMine((m) => [j.payment, ...m]);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-6 grid gap-5">
        <div className="flex items-center gap-2"><CreditCard className="text-accent" /><h1 className="text-lg font-semibold">Checkout</h1><span className="text-xs text-muted ml-2">Step 1 choose a plan · Step 2 pay · plan activates instantly</span></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
          {/* left: plan choice */}
          <div className="grid gap-4">
            <div className="grid sm:grid-cols-3 gap-3">
              {info.plans.filter((p) => p.priceMonthly > 0).map((p) => (
                <button key={p.id} className={`card p-4 text-left transition ${planId === p.id ? "border-accent ring-1 ring-accent" : "hover:border-accent2"}`} onClick={() => setPlanId(p.id)}>
                  <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span>{planId === p.id && <Check size={16} className="text-accent" />}</div>
                  <div className="text-xl font-bold mt-1">{cur(p.currency)}{p.priceMonthly}<span className="text-xs text-muted font-normal"> {p.perSeat ? "/ user" : ""} / {p.periodDays} days</span></div>
                  <ul className="text-xs text-muted mt-2 grid gap-0.5">{p.features.slice(0, 3).map((f) => <li key={f}>• {f}</li>)}</ul>
                </button>
              ))}
            </div>
            {plan?.perSeat && (
              <div className="card p-4 text-sm flex flex-wrap items-center gap-3"><span className="font-medium">Team size</span><input className="input !w-24" type="number" min={plan.minSeats ?? 1} value={nSeats} onChange={(e) => setSeats(Number(e.target.value))} /><span className="text-muted">users (minimum {plan.minSeats ?? 1}). You become the team owner and add members by email.</span></div>
            )}

            {plan && (
              <div className="card p-5 grid gap-4">
                <div className="flex items-center gap-2 font-medium"><Lock size={16} className="text-ok" /> Pay securely{primary ? ` via ${primary.label}` : ""}</div>
                {primary ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">{METHODS.map((m) => <span key={m} className="badge">{m}</span>)}</div>
                    <p className="text-xs text-muted">You will be taken to {primary.label}&apos;s secure payment page (PCI-DSS certified). Pay with any debit/credit card, mobile wallet, Bangla QR or internet banking. We never see your card details. Your plan activates automatically the moment the payment succeeds.</p>
                    <button className="btn btn-primary text-base justify-center py-3" onClick={() => payOnline(primary.id)} disabled={paying !== null}>
                      {paying === primary.id ? "Redirecting to secure payment…" : <><Zap size={18} /> Pay {cur(pay.currency)}{total.toLocaleString()} now{primary.sandbox ? " (test mode)" : ""}</>}
                    </button>
                    {others.length > 0 && <div className="flex flex-wrap gap-2 text-xs items-center"><span className="text-muted">Other:</span>{others.map((g) => <button key={g.id} className="btn btn-sm" onClick={() => payOnline(g.id)} disabled={paying !== null}>{g.id === "stripe" ? "International card" : g.label}{g.sandbox ? " (test)" : ""}</button>)}</div>}
                  </>
                ) : <p className="text-sm text-muted">Online payment is being set up. Use the manual transfer below.</p>}
                {err && <div className="text-err text-xs">{err}</div>}
              </div>
            )}

            {plan && manualMethods.length > 0 && (
              <div className="card">
                <button className="w-full flex items-center justify-between p-4 text-sm" onClick={() => setManualOpen((v) => !v)}><span className="font-medium">{primary ? "Prefer to send money manually? (bKash / Nagad / Rocket / bank)" : "Pay by manual transfer"}</span>{manualOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                {(manualOpen || !primary) && (
                  <div className="px-4 pb-4 grid gap-3 text-sm border-t border-border pt-3">
                    <div className="flex flex-wrap gap-2">{manualMethods.map(([id, label]) => <button key={id} className={`btn btn-sm ${method === id ? "btn-primary" : ""}`} onClick={() => setMethod(id)}>{label}</button>)}</div>
                    {method === "qr" && pay.qrImage ? <QrImage src={pay.qrImage} /> : <div className="text-base font-mono">{manualMethods.find(([id]) => id === method)?.[2]}</div>}
                    <p className="text-xs text-muted whitespace-pre-wrap">{pay.note}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div><label className="label">Transaction ID (TrxID)</label><input className="input mt-1" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. 9K7A3B2C1D" /></div>
                      <div><label className="label">Sender number / account</label><input className="input mt-1" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="01XXXXXXXXX" /></div>
                    </div>
                    {done ? <div className="text-ok flex items-center gap-2"><Check size={16} /> Submitted. We activate your plan after verifying the payment (usually within 24 hours).</div> : <button className="btn justify-self-start" onClick={submitManual} disabled={!txn}>Submit payment for verification</button>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* right: order summary */}
          <aside className="card p-5 grid gap-3 text-sm lg:sticky lg:top-4">
            <div className="font-medium">Order summary</div>
            {plan ? (
              <>
                <div className="flex justify-between"><span>{plan.name} plan{plan.perSeat ? ` × ${nSeats} users` : ""}</span><span>{cur(pay.currency)}{total.toLocaleString()}</span></div>
                <div className="flex justify-between text-muted text-xs"><span>Period</span><span>{plan.periodDays} days, no auto-renewal</span></div>
                <div className="flex justify-between text-muted text-xs"><span>AI credits</span><span>{plan.monthlyCredits.toLocaleString()} / month{plan.perSeat ? " per user" : ""}</span></div>
                <div className="border-t border-border pt-2 flex justify-between font-semibold"><span>Total</span><span>{cur(pay.currency)}{total.toLocaleString()}</span></div>
                <ul className="text-xs text-muted grid gap-1 mt-1">
                  <li className="flex gap-2"><ShieldCheck size={14} className="text-ok shrink-0" /> Secure payment, card data never touches our servers</li>
                  <li className="flex gap-2"><Zap size={14} className="text-ok shrink-0" /> Instant activation for online payments</li>
                  <li className="flex gap-2"><Check size={14} className="text-ok shrink-0" /> 7-day refund window · <Link className="text-accent2" href="/refund-policy">policy</Link></li>
                </ul>
                <div className="text-[11px] text-muted">Renewing early extends your current expiry; nothing is lost. Current plan: <b>{s.plan?.name}</b>{s.user.planExpires ? ` until ${new Date(s.user.planExpires).toLocaleDateString()}` : ""}.</div>
              </>
            ) : <div className="text-muted">Choose a plan.</div>}
            {info.site.supportEmail && <div className="text-[11px] text-muted">Questions? {info.site.supportEmail}</div>}
          </aside>
        </div>

        {mine.length > 0 && (
          <div className="card p-4 text-sm"><div className="label mb-2">Your payment history</div>
            <table className="w-full text-xs"><thead><tr className="text-left text-muted"><th>Date</th><th>Plan</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
              <tbody>{mine.map((p) => <tr key={p.id} className="border-t border-border"><td className="py-1">{new Date(p.createdAt).toLocaleDateString()}</td><td>{p.plan}</td><td>{p.method}</td><td>{cur(p.currency)}{p.amount}</td><td className="font-mono">{p.txnId}</td><td><span className={`badge ${p.status === "approved" ? "text-ok border-ok/40" : p.status === "rejected" ? "text-err border-err/40" : ""}`}>{p.status === "approved" ? "paid" : p.status}</span>{p.note && p.status === "rejected" ? <span className="text-muted"> ({p.note})</span> : null}</td></tr>)}</tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
