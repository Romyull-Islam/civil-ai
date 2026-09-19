"use client";
import { useState } from "react";
import Link from "next/link";
import { Zap, Check, ChevronDown, ChevronUp, Lock, FlaskConical } from "lucide-react";

export interface GatewayInfo { id: string; label: string; methods: string; sandbox: boolean }
export interface ManualPay { bkash: string; nagad: string; rocket: string; bank: string; qrImage: string; note: string; currency: string }

const METHODS = ["Visa", "Mastercard", "Amex", "bKash", "Nagad", "Rocket", "Upay", "Bangla QR", "Internet banking"];
export const cur = (c: string) => (c === "BDT" ? "৳" : c === "USD" ? "$" : c + " ");
// eslint-disable-next-line @next/next/no-img-element
const QrImage = ({ src }: { src: string }) => <img src={src} alt="Bangla QR" className="w-48 rounded-lg border border-border bg-white p-2" />;

/**
 * Pay for a plan period or an extra-credit pack ("credits:<id>"): online gateways first (SSLCommerz preferred), with a
 * manual bKash/Nagad/Rocket/bank transfer fallback. Works with no gateway configured (manual only) and says so clearly
 * when nothing is set up yet.
 */
export function PayPanel({ item, seats = 1, total, currency, gateways, manual, onManualSubmitted }: { item: string; seats?: number; total: number; currency: string; gateways: GatewayInfo[]; manual: ManualPay; onManualSubmitted?: () => void }) {
  const [paying, setPaying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [method, setMethod] = useState("bkash-manual"); const [txn, setTxn] = useState(""); const [sender, setSender] = useState(""); const [done, setDone] = useState(false);
  const primary = gateways.find((g) => g.id === "sslcommerz") ?? gateways.find((g) => g.id !== "stripe") ?? null;
  const others = gateways.filter((g) => g.id !== primary?.id);
  const manualMethods = ([["bkash-manual", "bKash", manual.bkash], ["nagad", "Nagad", manual.nagad], ["rocket", "Rocket", manual.rocket], ["qr", "Bangla QR", manual.qrImage ? "scan the QR" : ""], ["bank", "Bank transfer", manual.bank]] as [string, string, string][]).filter(([, , v]) => v);
  const testMode = gateways.some((g) => g.sandbox);
  const activeMethod = manualMethods.some(([id]) => id === method) ? method : manualMethods[0]?.[0] ?? method;

  const payOnline = async (gateway: string) => {
    setErr(null); setPaying(gateway);
    const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: item, gateway, seats }) });
    const j = await r.json(); setPaying(null);
    if (!r.ok) { setErr(j.error); return; }
    window.location.assign(j.url);
  };
  const submitManual = async () => {
    setErr(null);
    const r = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: item, method: activeMethod, amount: total, currency, txnId: txn, sender, seats }) });
    const j = await r.json(); if (!r.ok) { setErr(j.error); return; }
    setDone(true); onManualSubmitted?.();
  };

  if (!primary && !manualMethods.length) {
    return <div className="card p-5 text-sm grid gap-2"><div className="font-medium flex items-center gap-2"><Lock size={16} className="text-muted" /> Payments open soon</div><p className="text-muted text-xs">Online payment is being set up. Please contact support to subscribe in the meantime.</p><Link className="btn btn-sm justify-self-start" href="/help">Contact support</Link></div>;
  }
  return (
    <div className="grid gap-4">
      <div className="card p-5 grid gap-4">
        <div className="flex items-center gap-2 font-medium"><Lock size={16} className="text-ok" /> Pay securely{primary ? ` via ${primary.label}` : ""}</div>
        {testMode && <div className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-xs flex gap-2"><FlaskConical size={14} className="text-accent shrink-0 mt-0.5" /> Test mode (visible to staff only): no real money is taken. Use the gateway&apos;s test card or wallet numbers. Customers do not see test-mode gateways.</div>}
        {primary ? (
          <>
            <div className="flex flex-wrap gap-1.5">{METHODS.map((m) => <span key={m} className="badge">{m}</span>)}</div>
            <p className="text-xs text-muted">You will be taken to {primary.label}&apos;s secure payment page (PCI-DSS certified). Pay with any debit or credit card, mobile wallet, Bangla QR or internet banking. We never see your card details, and your purchase activates the moment the payment succeeds.</p>
            <button className="btn btn-primary text-base justify-center py-3" onClick={() => payOnline(primary.id)} disabled={paying !== null || total <= 0}>
              {paying === primary.id ? "Redirecting to secure payment…" : <><Zap size={18} /> Pay {cur(currency)}{total.toLocaleString()} now</>}
            </button>
            {others.length > 0 && <div className="flex flex-wrap gap-2 text-xs items-center"><span className="text-muted">Or pay with:</span>{others.map((g) => <button key={g.id} className="btn btn-sm" onClick={() => payOnline(g.id)} disabled={paying !== null}>{g.id === "stripe" ? "International card (USD)" : g.label}</button>)}</div>}
          </>
        ) : <p className="text-sm text-muted">Online card and wallet payment is being set up. You can pay by manual transfer below.</p>}
        {err && <div className="text-err text-xs">{err}</div>}
      </div>

      {manualMethods.length > 0 && (
        <div className="card">
          <button className="w-full flex items-center justify-between p-4 text-sm" onClick={() => setManualOpen((v) => !v)}><span className="font-medium">{primary ? "Prefer to send money manually? (bKash / Nagad / Rocket / bank)" : "Pay by manual transfer"}</span>{manualOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
          {(manualOpen || !primary) && (
            <div className="px-4 pb-4 grid gap-3 text-sm border-t border-border pt-3">
              <div className="flex flex-wrap gap-2">{manualMethods.map(([id, label]) => <button key={id} className={`btn btn-sm ${activeMethod === id ? "btn-primary" : ""}`} onClick={() => setMethod(id)}>{label}</button>)}</div>
              {activeMethod === "qr" && manual.qrImage ? <QrImage src={manual.qrImage} /> : <div className="text-base font-mono">{manualMethods.find(([id]) => id === activeMethod)?.[2]}</div>}
              <div className="text-sm">Amount: <b>{cur(currency)}{total.toLocaleString()}</b></div>
              <p className="text-xs text-muted whitespace-pre-wrap">{manual.note}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <div><label className="label">Transaction ID (TrxID)</label><input className="input mt-1" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. 9K7A3B2C1D" /></div>
                <div><label className="label">Sender number / account</label><input className="input mt-1" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="01XXXXXXXXX" /></div>
              </div>
              {done ? <div className="text-ok flex items-center gap-2"><Check size={16} /> Submitted. We activate it after verifying the payment (usually within 24 hours). You can follow it on the <Link className="text-accent2" href="/billing">Billing</Link> page.</div> : <button className="btn justify-self-start" onClick={submitManual} disabled={!txn}>Submit payment for verification</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
