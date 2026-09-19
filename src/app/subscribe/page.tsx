"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, ShieldCheck, Zap, Check, ArrowRightLeft } from "lucide-react";
import { useSession } from "@/lib/client/session";
import { PayPanel, cur, type GatewayInfo, type ManualPay } from "@/components/PayPanel";
import { useNow } from "@/lib/client/now";

interface SiteInfo {
  gateways: GatewayInfo[];
  site: { appName: string; payment: ManualPay & { conversion: number }; supportEmail: string };
  plans: { id: string; name: string; priceMonthly: number; currency: string; periodDays: number; features: string[]; monthlyCredits: number; weeklyCredits: number; sessionCredits: number; sessionHours?: number; perSeat?: boolean; minSeats?: number }[];
}

/** Checkout for plans: choose a plan, see what carries over from the current plan, pay online or by manual transfer. */
export default function SubscribePage() {
  const s = useSession();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [planId, setPlanId] = useState("");
  const [seats, setSeats] = useState(3);
  const now = useNow();

  useEffect(() => {
    fetch("/api/site").then((r) => r.json()).then((j: SiteInfo) => { setInfo(j); const q = new URLSearchParams(window.location.search).get("plan"); setPlanId(q && j.plans.some((p) => p.id === q) ? q : j.plans.find((p) => p.priceMonthly > 0)?.id ?? ""); });
    fetch("/api/billing").then((r) => (r.ok ? r.json() : null)).then((j) => j && setQuotes(j.quotes ?? {})).catch(() => {});
  }, []);
  if (!info) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (!s?.user) return <div className="p-6 text-sm">Please <Link className="text-accent2" href="/login?next=/subscribe">sign in</Link> to subscribe.</div>;

  const plan = info.plans.find((p) => p.id === planId);
  const pay = info.site.payment;
  const nSeats = plan?.perSeat ? Math.max(plan.minSeats ?? 1, seats) : 1;
  const unit = plan ? Math.round(plan.priceMonthly * (pay.currency === plan.currency ? 1 : pay.conversion)) : 0;
  const total = unit * nSeats;
  const carried = plan ? quotes[plan.id] ?? 0 : 0;
  const sameRenewal = plan && s.plan?.id === plan.id && s.user.planExpires && s.user.planExpires > now;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-6 grid gap-5">
        <div className="flex flex-wrap items-center gap-2"><CreditCard className="text-accent" /><h1 className="text-lg font-semibold">Checkout</h1><span className="text-xs text-muted ml-2">Step 1 choose a plan · Step 2 pay · activates instantly</span><Link className="text-xs text-accent2 ml-auto" href="/billing">Billing &amp; receipts</Link></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
          <div className="grid gap-4">
            <div className="grid sm:grid-cols-3 gap-3">
              {info.plans.filter((p) => p.priceMonthly > 0).map((p) => (
                <button key={p.id} className={`card p-4 text-left transition ${planId === p.id ? "border-accent ring-1 ring-accent" : "hover:border-accent2"}`} onClick={() => setPlanId(p.id)}>
                  <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span>{planId === p.id && <Check size={16} className="text-accent" />}</div>
                  <div className="text-xl font-bold mt-1">{cur(p.currency)}{p.priceMonthly}<span className="text-xs text-muted font-normal"> {p.perSeat ? "/ user" : ""} / {p.periodDays} days</span></div>
                  <ul className="text-xs text-muted mt-2 grid gap-0.5">{p.features.slice(0, 4).map((f) => <li key={f}>• {f}</li>)}</ul>
                </button>
              ))}
            </div>
            {plan?.perSeat && (
              <div className="card p-4 text-sm flex flex-wrap items-center gap-3"><span className="font-medium">Team size</span><input className="input !w-24" type="number" min={plan.minSeats ?? 1} value={nSeats} onChange={(e) => setSeats(Number(e.target.value))} /><span className="text-muted">users (minimum {plan.minSeats ?? 1}). You become the team owner and add members by email.</span></div>
            )}
            {plan && <PayPanel item={plan.id} seats={nSeats} total={total} currency={pay.currency} gateways={info.gateways} manual={pay} />}
          </div>

          <aside className="card p-5 grid gap-3 text-sm lg:sticky lg:top-4">
            <div className="font-medium">Order summary</div>
            {plan ? (
              <>
                <div className="flex justify-between"><span>{plan.name} plan{plan.perSeat ? ` × ${nSeats} users` : ""}</span><span>{cur(pay.currency)}{total.toLocaleString()}</span></div>
                <div className="flex justify-between text-muted text-xs"><span>Period</span><span>{plan.periodDays} days, no auto-renewal</span></div>
                <div className="flex justify-between text-muted text-xs"><span>AI credits</span><span>{plan.monthlyCredits.toLocaleString()} / month{plan.perSeat ? " per user" : ""}</span></div>
                <div className="flex justify-between text-muted text-xs"><span>Limits</span><span>up to {plan.weeklyCredits.toLocaleString()} / week, {plan.sessionCredits} per {plan.sessionHours ?? 5}-hour session</span></div>
                {carried > 0 && <div className="rounded-lg bg-elev2 px-3 py-2 text-xs flex gap-2"><ArrowRightLeft size={14} className="text-accent shrink-0 mt-0.5" /> Your unused {s.plan?.name} time is worth <b>{carried} extra days</b> of {plan.name}, added on top of the {plan.periodDays} days.</div>}
                {sameRenewal && <div className="rounded-lg bg-elev2 px-3 py-2 text-xs">Renewing early adds {plan.periodDays} days to your current expiry ({new Date(s.user.planExpires!).toLocaleDateString()}). Nothing is lost.</div>}
                <div className="border-t border-border pt-2 flex justify-between font-semibold"><span>Total</span><span>{cur(pay.currency)}{total.toLocaleString()}</span></div>
                <ul className="text-xs text-muted grid gap-1 mt-1">
                  <li className="flex gap-2"><ShieldCheck size={14} className="text-ok shrink-0" /> Secure payment, card data never touches our servers</li>
                  <li className="flex gap-2"><Zap size={14} className="text-ok shrink-0" /> Instant activation for online payments</li>
                  <li className="flex gap-2"><Check size={14} className="text-ok shrink-0" /> Receipt by email and on the Billing page · 7-day refund window · <Link className="text-accent2" href="/refund-policy">policy</Link></li>
                </ul>
                <div className="text-[11px] text-muted">Current plan: <b>{s.plan?.name}</b>{s.user.planExpires ? ` until ${new Date(s.user.planExpires).toLocaleDateString()}` : ""}. Need more AI credits only? <Link className="text-accent2" href="/billing#credits">Buy a credit pack</Link>.</div>
              </>
            ) : <div className="text-muted">Choose a plan.</div>}
            {info.site.supportEmail && <div className="text-[11px] text-muted">Questions? {info.site.supportEmail}</div>}
          </aside>
        </div>
      </div>
    </div>
  );
}
