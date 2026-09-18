/**
 * Generic payment webhook for automatic activation/renewal. Any gateway (SSLCommerz, aamarPay, ShurjoPay, bKash merchant API,
 * Stripe) or an automation tool can POST here after a successful charge:
 *   POST /api/webhooks/payment   Authorization: Bearer $PAYMENT_WEBHOOK_SECRET
 *   { "email": "user@x.com", "plan": "pro", "txnId": "ABC123", "amount": 1440, "currency": "BDT", "method": "sslcommerz", "days": 30 }
 * Idempotent per txnId. Records the payment as approved and extends the plan from the current expiry.
 */
import { getDB } from "@/lib/saas/db";
import { activatePlan } from "@/lib/saas/service";
import { newId } from "@/lib/saas/crypto";
import { sendEmail } from "@/lib/saas/email";
import { getSite } from "@/lib/saas/site";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "PAYMENT_WEBHOOK_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json()) as { email: string; plan: string; txnId: string; amount?: number; currency?: string; method?: string; days?: number };
  if (!b.email || !b.plan || !b.txnId) return Response.json({ error: "email, plan and txnId are required" }, { status: 400 });
  const db = await getDB();
  const user = await db.getUserByEmail(b.email);
  if (!user) return Response.json({ error: "No account with that email" }, { status: 404 });
  const dup = (await db.listPayments({ userId: user.id, limit: 500 })).find((p) => p.txnId === b.txnId);
  if (dup) return Response.json({ ok: true, duplicate: true, paymentId: dup.id });
  const r = await activatePlan(user.id, b.plan, b.days);
  if (!r) return Response.json({ error: "Unknown plan" }, { status: 400 });
  const id = newId();
  await db.createPayment({ id, userId: user.id, email: user.email, plan: b.plan, method: b.method ?? "webhook", amount: Number(b.amount ?? 0), currency: b.currency ?? "BDT", txnId: b.txnId, sender: "", status: "approved", note: "auto (webhook)", createdAt: Date.now(), reviewedAt: Date.now() });
  const site = await getSite();
  sendEmail(user.email, `${site.appName}: ${r.plan.name} plan ${user.plan === b.plan ? "renewed" : "activated"}`, `Payment ${b.txnId} received. Your ${r.plan.name} plan is active until ${new Date(r.expires).toDateString()}.`).catch(() => {});
  return Response.json({ ok: true, paymentId: id, expires: r.expires });
}
