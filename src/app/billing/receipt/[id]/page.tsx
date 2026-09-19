"use client";
import { useEffect, useState, use } from "react";
import { Printer } from "lucide-react";
import { LogoMark } from "@/components/Logo";

interface ReceiptData {
  no: string; date: number; status: string;
  seller: { name: string; address: string; phone: string; email: string; tradeLicense: string; bin: string; app: string };
  customer: { email: string };
  item: string; carriedDays: number; method: string; reference: string; currency: string;
  net: number; vat: number; total: number; vatPercent: number; pricesIncludeVat: boolean; note: string;
}
const money = (c: string, n: number) => `${c === "BDT" ? "৳" : c + " "}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Printable receipt (no app chrome). "Print / Save as PDF" uses the browser's print dialog. */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [r, setR] = useState<ReceiptData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/billing/receipt?id=${encodeURIComponent(id)}`).then(async (res) => { const j = await res.json(); if (res.ok) setR(j.receipt); else setErr(j.error); }); }, [id]);
  if (err) return <div className="p-8 text-sm">{err}</div>;
  if (!r) return <div className="p-8 text-sm text-muted">Loading…</div>;
  const s = r.seller;
  return (
    <div className="min-h-full bg-white text-black print:p-0 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto border border-gray-300 rounded-lg p-6 sm:p-8 print:border-0 grid gap-6 text-sm">
        <div className="flex items-start gap-3">
          <LogoMark size={40} />
          <div className="grid gap-0.5">
            <div className="text-lg font-semibold">{s.name}</div>
            {s.name !== s.app && <div className="text-gray-600">{s.app}</div>}
            {s.address && <div className="text-gray-600">{s.address}</div>}
            <div className="text-gray-600">{[s.phone, s.email].filter(Boolean).join(" · ")}</div>
            {(s.tradeLicense || s.bin) && <div className="text-gray-600">{[s.tradeLicense && `Trade licence: ${s.tradeLicense}`, s.bin && `BIN: ${s.bin}`].filter(Boolean).join(" · ")}</div>}
          </div>
          <div className="ml-auto text-right">
            <div className="text-xl font-bold tracking-wide">{r.status === "refunded" ? "RECEIPT (REFUNDED)" : "RECEIPT"}</div>
            <div className="text-gray-600">No. {r.no}</div>
            <div className="text-gray-600">{new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
          </div>
        </div>
        <div><div className="text-xs uppercase text-gray-500">Billed to</div><div>{r.customer.email}</div></div>
        <table className="w-full">
          <thead><tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-300"><th className="py-2">Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-gray-200"><td className="py-2">{r.item}{r.carriedDays ? <div className="text-xs text-gray-500">Includes {r.carriedDays} days carried over from the previous plan</div> : null}</td><td className="text-right">{money(r.currency, r.net)}</td></tr>
            {r.vatPercent > 0 && <tr><td className="py-1 text-right text-gray-600">VAT {r.vatPercent}%{r.pricesIncludeVat ? " (included)" : ""}</td><td className="text-right">{money(r.currency, r.vat)}</td></tr>}
            <tr className="font-semibold"><td className="py-2 text-right">Total paid</td><td className="text-right">{money(r.currency, r.total)}</td></tr>
          </tbody>
        </table>
        <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-600">
          <div>Payment method: <b className="text-black">{r.method}</b></div>
          <div>Reference: <span className="font-mono text-black">{r.reference}</span></div>
          <div>Status: <b className="text-black">{r.status === "refunded" ? "Refunded" : "Paid"}</b></div>
        </div>
        {r.note && <div className="text-xs text-gray-500 border-t border-gray-200 pt-3">{r.note}</div>}
        <button className="btn btn-primary justify-self-start print:hidden" onClick={() => window.print()}><Printer size={14} /> Print / Save as PDF</button>
      </div>
    </div>
  );
}
