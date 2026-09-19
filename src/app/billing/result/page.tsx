"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, Receipt, RefreshCw } from "lucide-react";

interface PaymentView { id: string; status: string; plan: string; amount: number; currency: string; method: string; ref: string; carriedDays: number }
const q = (k: string) => () => new URLSearchParams(window.location.search).get(k);

/** Where the gateway sends the customer back: shows the outcome, keeps checking while the payment is still pending. */
export default function PaymentResultPage() {
  const pid = useSyncExternalStore(() => () => {}, q("pid"), () => null);
  const initial = useSyncExternalStore(() => () => {}, q("status"), () => null);
  const [p, setP] = useState<PaymentView | null>(null);
  const [tries, setTries] = useState(0);
  const status = p?.status === "approved" ? "paid" : p?.status === "rejected" ? "failed" : p?.status === "pending" ? "pending" : initial ?? "pending";

  useEffect(() => {
    if (!pid) return;
    const get = (method: "GET" | "POST") => (method === "GET" ? fetch(`/api/billing/payment?pid=${encodeURIComponent(pid)}`) : fetch("/api/billing/payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid }) })).then((r) => (r.ok ? r.json() : null)).then((j) => j?.payment && setP(j.payment));
    get("GET");
    if (status !== "pending" || tries >= 8) return;
    // Pending: ask the gateway again every 5 seconds for about 40 seconds.
    const t = setTimeout(() => { get("POST"); setTries((n) => n + 1); }, 5000);
    return () => clearTimeout(t);
  }, [pid, status, tries]);

  const money = p ? `${p.currency === "BDT" ? "৳" : p.currency + " "}${p.amount.toLocaleString()}` : "";
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto p-6 grid gap-4 mt-6">
        <div className="card p-6 grid gap-3 text-center justify-items-center">
          {status === "paid" && <><CheckCircle2 size={48} className="text-ok" /><h1 className="text-xl font-semibold">Payment successful</h1><p className="text-sm text-muted">{money ? `${money} received. ` : ""}Your purchase is active now.{p?.carriedDays ? ` ${p.carriedDays} days from your previous plan were carried over.` : ""} A receipt has been emailed to you.</p></>}
          {status === "pending" && <><Clock size={48} className="text-accent" /><h1 className="text-xl font-semibold">Confirming your payment…</h1><p className="text-sm text-muted">{tries < 8 ? "This usually takes a few seconds. Please keep this page open." : "The payment gateway has not confirmed it yet. If money was taken, it will activate automatically within 15 minutes; you can also press Check status on the Billing page."}</p></>}
          {(status === "failed" || status === "cancelled" || status === "invalid") && <><XCircle size={48} className="text-err" /><h1 className="text-xl font-semibold">{status === "cancelled" ? "Payment cancelled" : "Payment not completed"}</h1><p className="text-sm text-muted">{status === "cancelled" ? "No money was taken. You can try again whenever you like." : "The payment did not go through, or could not be verified. If money was deducted, contact support with the reference below and we will sort it out."}</p></>}
          {p?.ref && <div className="text-xs text-muted">Reference: <span className="font-mono">{p.ref}</span></div>}
          <div className="flex flex-wrap gap-2 justify-center mt-2">
            {status === "paid" && <><Link className="btn btn-primary" href="/">Start using CivilMate</Link>{p && <Link className="btn" href={`/billing/receipt/${p.id}`} target="_blank"><Receipt size={14} /> Receipt</Link>}</>}
            {status === "pending" && <Link className="btn" href="/billing"><RefreshCw size={14} /> Billing page</Link>}
            {(status === "failed" || status === "cancelled" || status === "invalid") && <><Link className="btn btn-primary" href={p?.plan?.startsWith("credits:") ? "/billing#credits" : `/subscribe${p?.plan ? `?plan=${p.plan}` : ""}`}>Try again</Link><Link className="btn" href="/help">Contact support</Link></>}
          </div>
        </div>
      </div>
    </div>
  );
}
