/** Stripe webhook: checkout.session.completed (one-off) and invoice.paid (recurring renewals). Configure the endpoint in Stripe → Developers → Webhooks. */
import { getGatewayConfig } from "@/lib/saas/gateways";
import { verifyStripeSignature } from "@/lib/saas/gateways/stripe";
import { completeCheckout } from "@/lib/saas/checkout";
import { getDB } from "@/lib/saas/db";
import { activatePlan } from "@/lib/saas/service";
import { newId } from "@/lib/saas/crypto";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const cfg = await getGatewayConfig("stripe");
  const payload = await req.text();
  if (!cfg.values.webhook_secret || !verifyStripeSignature(payload, req.headers.get("stripe-signature"), cfg.values.webhook_secret)) return Response.json({ error: "Bad signature" }, { status: 400 });
  const ev = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  const o = ev.data.object;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  if (ev.type === "checkout.session.completed" && o.client_reference_id) {
    const r = await completeCheckout("stripe", String(o.client_reference_id), { outcome: "success", session_id: String(o.id) }, base);
    return Response.json(r);
  }
  if (ev.type === "invoice.paid") {
    // Recurring renewal: identify user by customer email and plan by subscription metadata.
    const email = String(o.customer_email ?? (o.customer_details as { email?: string } | undefined)?.email ?? "");
    const lines = (o.lines as { data?: { metadata?: { plan?: string } }[] } | undefined)?.data ?? [];
    const plan = (o.subscription_details as { metadata?: { plan?: string } } | undefined)?.metadata?.plan ?? lines[0]?.metadata?.plan;
    const db = await getDB();
    const user = email ? await db.getUserByEmail(email) : null;
    if (!user || !plan) return Response.json({ ignored: true });
    const txnId = String(o.id);
    if ((await db.listPayments({ userId: user.id, limit: 500 })).some((p) => p.txnId === txnId)) return Response.json({ duplicate: true });
    const r = await activatePlan(user.id, plan);
    await db.createPayment({ id: newId(), userId: user.id, email: user.email, plan, method: "stripe", amount: Number(o.amount_paid ?? 0) / 100, currency: String(o.currency ?? "usd").toUpperCase(), txnId, sender: "", status: "approved", note: "auto (stripe recurring)", createdAt: Date.now(), reviewedAt: Date.now(), seats: 1 });
    return Response.json({ ok: !!r });
  }
  return Response.json({ ignored: ev.type });
}
