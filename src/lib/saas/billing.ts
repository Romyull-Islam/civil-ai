/** Billing helpers shared by the Billing page, receipts and admin: what a payment bought and its VAT breakdown. */
import type { Payment } from "./db";
import { PACK_PREFIX, type CreditPack, type Plan } from "./plans";

/** VAT part of an amount. With VAT-inclusive prices the total stays the same and VAT is carved out of it. */
export function vatBreakdown(amount: number, vatPercent: number, pricesIncludeVat: boolean): { net: number; vat: number; total: number } {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (!vatPercent) return { net: r(amount), vat: 0, total: r(amount) };
  if (pricesIncludeVat) { const net = amount / (1 + vatPercent / 100); return { net: r(net), vat: r(amount - net), total: r(amount) }; }
  const vat = (amount * vatPercent) / 100;
  return { net: r(amount), vat: r(vat), total: r(amount + vat) };
}

/** Human description of what a payment bought. */
export function purchaseLabel(p: Pick<Payment, "plan" | "seats">, plans: Plan[], packs: CreditPack[]): string {
  if (p.plan.startsWith(PACK_PREFIX)) { const k = packs.find((x) => PACK_PREFIX + x.id === p.plan); return k ? `${k.name}: ${k.credits} extra AI credits (valid ${k.validityDays} days)` : "Extra AI credits"; }
  const plan = plans.find((x) => x.id === p.plan);
  return `${plan?.name ?? p.plan} plan, ${plan?.periodDays ?? 30} days${p.seats > 1 ? ` × ${p.seats} users` : ""}`;
}

/** Receipt number derived from the payment (stable, unique, printable). */
export const receiptNo = (p: Pick<Payment, "id" | "createdAt">) => `CM-${new Date(p.createdAt).toISOString().slice(0, 7).replace("-", "")}-${p.id.slice(0, 8).toUpperCase()}`;

/** Online gateway ids. A payment is an online checkout only if it also carries our own "CIV…" reference. */
export const ONLINE_GATEWAYS = ["sslcommerz", "aamarpay", "shurjopay", "bkash", "stripe"];
export const ONLINE_REF_PREFIX = "CIV";
/**
 * True for payments created by our online checkout. Manual transfers (including manual bKash, which older versions
 * stored with method "bkash", the same id as the bKash gateway) carry the customer's own TrxID instead.
 */
export const isOnlinePayment = (p: { method: string; txnId: string }) => ONLINE_GATEWAYS.includes(p.method) && p.txnId.startsWith(ONLINE_REF_PREFIX);

/** Friendly method names for receipts and history. */
export const METHOD_LABEL: Record<string, string> = { sslcommerz: "Online (SSLCommerz)", aamarpay: "Online (aamarPay)", shurjopay: "Online (shurjoPay)", bkash: "bKash (online)", stripe: "Card (Stripe)", "bkash-manual": "bKash (manual)", qr: "Bangla QR", bank: "Bank transfer", nagad: "Nagad", rocket: "Rocket" };
export const methodLabel = (m: string, txnId = ONLINE_REF_PREFIX) => (m === "bkash" && !txnId.startsWith(ONLINE_REF_PREFIX) ? "bKash (manual)" : METHOD_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1));
