/** All payments as CSV (for accounts, VAT returns and reconciliation with gateway statements). */
import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { getPlans, getCreditPacks } from "@/lib/saas/service";
import { purchaseLabel, receiptNo, methodLabel } from "@/lib/saas/billing";
export const runtime = "nodejs";
const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const GET = guardArea("payments", async () => {
  const [payments, plans, packs] = await Promise.all([(await getDB()).listPayments({ limit: 100000 }), getPlans(), getCreditPacks()]);
  const rows = [["date", "receipt_no", "email", "item", "method", "amount", "currency", "reference", "status", "note"],
    ...payments.map((p) => [new Date(p.createdAt).toISOString(), p.status === "approved" || p.status === "refunded" ? receiptNo(p) : "", p.email, purchaseLabel(p, plans, packs), methodLabel(p.method, p.txnId), p.amount, p.currency, p.txnId, p.status, p.note])];
  return new Response(rows.map((r) => r.map(cell).join(",")).join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="civilmate-payments-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
