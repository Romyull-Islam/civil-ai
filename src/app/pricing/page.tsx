"use client";
import Link from "next/link";
import { Check } from "lucide-react";
import { useSession } from "@/lib/client/session";

export default function PricingPage() {
  const s = useSession();
  const plans = s?.plans ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 grid gap-6">
        <div className="text-center"><h1 className="text-2xl font-semibold">Plans</h1><p className="text-sm text-muted mt-1">Calculators, drawings and the code library are free for everyone. Plans set your daily AI assistant requests and which models answer.</p></div>
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.id} className={`card p-5 grid gap-3 ${s?.user?.plan === p.id ? "border-accent" : ""}`}>
              <div><div className="font-semibold text-lg">{p.name}</div><div className="text-2xl font-bold mt-1">{p.priceMonthly === 0 ? "Free" : `${p.currency === "USD" ? "$" : p.currency === "BDT" ? "৳" : p.currency + " "}${p.priceMonthly}`}<span className="text-sm text-muted font-normal">{p.priceMonthly ? " / month" : ""}</span></div></div>
              <ul className="grid gap-1 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check size={16} className="text-ok shrink-0 mt-0.5" />{f}</li>)}</ul>
              {s?.user?.plan === p.id ? <span className="badge justify-self-start text-ok border-ok/40">current plan</span> : s?.user ? (p.priceMonthly > 0 ? <Link href={`/subscribe?plan=${p.id}`} className="btn btn-primary justify-center">Subscribe (bKash / Nagad / Rocket / QR)</Link> : <span className="text-xs text-muted">Included</span>) : <Link href="/signup" className="btn btn-primary justify-center">Get started</Link>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
