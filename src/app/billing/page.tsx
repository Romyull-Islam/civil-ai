"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Receipt, RefreshCw, Sparkles, Coins, CalendarClock } from "lucide-react";
import { useSession } from "@/lib/client/session";
import { PayPanel, cur, type GatewayInfo, type ManualPay } from "@/components/PayPanel";
import { UsageBars } from "@/components/UsageBars";
import { useNow } from "@/lib/client/now";

interface BillingInfo {
  plan: { id: string; name: string; priceMonthly: number; currency: string; periodDays: number; monthlyCredits: number; features: string[] };
  expires: number | null;
  renewal: { status: "none" | "ok" | "expiring" | "grace" | "expired"; daysLeft: number | null };
  usage: Parameters<typeof UsageBars>[0]["usage"];
  packs: { id: string; name: string; price: number; currency: string; credits: number; validityDays: number }[];
  gateways: GatewayInfo[];
  currency: string;
  grants: { credits: number; remaining: number; expiresAt: number; note: string }[];
  payments: { id: string; createdAt: number; what: string; method: string; online: boolean; amount: number; currency: string; ref: string; status: string; carriedDays: number }[];
}
const STATUS: Record<string, [string, string]> = { approved: ["Paid", "text-ok border-ok/40"], pending: ["Pending", "text-accent border-accent/40"], rejected: ["Failed", "text-err border-err/40"], expired: ["Not completed", "text-muted"], refunded: ["Refunded", "text-muted"] };

/** Billing: current plan and renewal, AI credit packs, and payment history with receipts. */
export default function BillingPage() {
  const s = useSession();
  const now = useNow();
  const [b, setB] = useState<BillingInfo | null>(null);
  const [manual, setManual] = useState<ManualPay | null>(null);
  const [pack, setPack] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/billing").then((r) => (r.ok ? r.json() : null)).then(setB);
    fetch("/api/site").then((r) => r.json()).then((j) => setManual(j.site?.payment ?? null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const recheck = async (id: string) => { setChecking(id); await fetch("/api/billing/payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid: id }) }); setChecking(null); load(); };

  if (!s) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (!s.user) return <div className="p-6 text-sm">Please <Link className="text-accent2" href="/login?next=/billing">sign in</Link>.</div>;
  if (!b || !manual) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const chosen = b.packs.find((p) => p.id === pack);
  const free = b.plan.priceMonthly <= 0;
  const expiry = b.expires ? new Date(b.expires).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 grid gap-5">
        <div className="flex items-center gap-2"><CreditCard className="text-accent" /><h1 className="text-lg font-semibold">Plans &amp; billing</h1></div>

        <section className="card p-5 grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div><div className="label">Current plan</div><div className="text-xl font-semibold">{b.plan.name}</div></div>
            <div className="text-muted text-xs">
              {free ? "Free plan: calculators, drawings and the code library are unlimited; AI answers use your free monthly credits." : <><CalendarClock size={13} className="inline mr-1" />{b.renewal.status === "grace" ? `Expired, still active during the grace period (renew now to keep it)` : b.renewal.status === "expired" ? "Expired" : `Active until ${expiry}${b.renewal.daysLeft !== null ? ` (${b.renewal.daysLeft} days left)` : ""}`}. No automatic renewal.</>}
            </div>
            <div className="ml-auto flex gap-2">
              <Link className="btn btn-primary" href={`/subscribe${free ? "" : `?plan=${b.plan.id}`}`}><Sparkles size={15} /> {free ? "Upgrade" : "Renew"}</Link>
              {!free && <Link className="btn" href="/subscribe">Change plan</Link>}
            </div>
          </div>
          {(b.renewal.status === "expiring" || b.renewal.status === "grace") && <div className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-xs">Your plan {b.renewal.status === "grace" ? "has expired" : "expires soon"}. Renewing early adds a full period to the current expiry, so nothing is lost.</div>}
          <div className="border-t border-border pt-3"><UsageBars usage={b.usage} compact now={now} /></div>
        </section>

        <section id="credits" className="grid gap-3">
          <div className="flex items-center gap-2"><Coins size={18} className="text-accent" /><h2 className="font-semibold">Buy extra AI credits</h2></div>
          <p className="text-xs text-muted -mt-1">Used only when your session, weekly or monthly limit is reached, so you can keep working. Valid for 90 days. A plan upgrade is better value if you often run out.</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {b.packs.map((p) => (
              <button key={p.id} className={`card p-4 text-left transition ${pack === p.id ? "border-accent ring-1 ring-accent" : "hover:border-accent2"}`} onClick={() => setPack(p.id)}>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xl font-bold mt-1">{p.credits.toLocaleString()} <span className="text-sm font-normal text-muted">credits</span></div>
                <div className="text-sm">{cur(p.currency)}{p.price}</div>
                <div className="text-[11px] text-muted mt-1">≈ {Math.floor(p.credits / 4)} questions on Gemini Flash-Lite · valid {p.validityDays} days</div>
              </button>
            ))}
          </div>
          {b.grants.length > 0 && <div className="text-xs text-muted">Your extra credits: {b.grants.map((g) => `${g.remaining} of ${g.credits} (${g.note}, until ${new Date(g.expiresAt).toLocaleDateString()})`).join(" · ")}</div>}
          {chosen && <PayPanel item={`credits:${chosen.id}`} total={chosen.price} currency={b.currency} gateways={b.gateways} manual={manual} onManualSubmitted={load} />}
        </section>

        <section className="card p-5 grid gap-3 text-sm">
          <div className="flex items-center gap-2"><Receipt size={16} className="text-accent" /><h2 className="font-semibold">Payment history</h2><button className="btn btn-sm ml-auto" onClick={load} title="Refresh"><RefreshCw size={13} /></button></div>
          {b.payments.length ? (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-muted"><th className="py-1">Date</th><th>What</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th><th></th></tr></thead>
              <tbody>{b.payments.map((p) => { const [label, cls] = STATUS[p.status] ?? [p.status, ""]; return (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="py-1.5 whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td>{p.what}{p.carriedDays ? <div className="text-muted">+{p.carriedDays} days carried over</div> : null}</td>
                  <td>{p.method}</td>
                  <td className="whitespace-nowrap">{cur(p.currency)}{p.amount.toLocaleString()}</td>
                  <td className="font-mono break-all">{p.ref}</td>
                  <td><span className={`badge ${cls}`}>{label}</span>{p.status === "pending" && !p.online && <div className="text-muted mt-0.5">awaiting verification</div>}</td>
                  <td className="text-right whitespace-nowrap">
                    {(p.status === "approved" || p.status === "refunded") && <Link className="text-accent2" href={`/billing/receipt/${p.id}`} target="_blank">Receipt</Link>}
                    {p.status === "pending" && p.online && <button className="btn btn-sm" onClick={() => recheck(p.id)} disabled={checking === p.id}>{checking === p.id ? "Checking…" : "Check status"}</button>}
                  </td>
                </tr>); })}</tbody>
            </table></div>
          ) : <div className="text-muted text-xs">No payments yet.</div>}
          <p className="text-[11px] text-muted">Paid online but the plan is not active? Press &quot;Check status&quot;, or open a ticket on the <Link className="text-accent2" href="/help">Help</Link> page with the reference. Refunds: see the <Link className="text-accent2" href="/refund-policy">refund policy</Link>.</p>
        </section>
      </div>
    </div>
  );
}
