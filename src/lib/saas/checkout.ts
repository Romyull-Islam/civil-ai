/** Online checkout orchestration: create a pending payment → send the user to the gateway → verify on return/IPN → activate plan. Idempotent per payment id. */
import { getDB, type Payment, type User } from "./db";
import { newId } from "./crypto";
import { getPlans, activatePlan } from "./service";
import { getSite } from "./site";
import { sendEmail } from "./email";
import { gatewayById, getGatewayConfig, type CheckoutContext } from "./gateways";

export async function startCheckout(user: User, planId: string, gatewayId: string, baseUrl: string, seatsWanted?: number): Promise<{ url: string; paymentId: string }> {
  const g = gatewayById(gatewayId);
  if (!g) throw new Error("Unknown payment gateway");
  const cfg = await getGatewayConfig(gatewayId);
  if (!cfg.enabled) throw new Error("This payment method is not enabled");
  const plan = (await getPlans()).find((p) => p.id === planId);
  if (!plan || plan.priceMonthly <= 0) throw new Error("Choose a paid plan");
  const site = await getSite();
  // Stripe charges in the plan currency (USD); Bangladeshi gateways in the local currency.
  const intl = gatewayId === "stripe";
  const seats = plan.perSeat ? Math.max(plan.minSeats ?? 1, Math.floor(seatsWanted ?? 0)) : 1;
  const currency = intl ? "USD" : site.payment.currency;
  const unit = intl ? (plan.priceUSD ?? Math.round((plan.priceMonthly / (site.payment.conversion || 120)) * 100) / 100) : Math.round(plan.priceMonthly * (site.payment.currency === plan.currency ? 1 : site.payment.conversion));
  const amount = Math.round(unit * seats * 100) / 100;
  const paymentId = `CIV${Date.now().toString(36).toUpperCase()}${newId().slice(0, 6).toUpperCase()}`;
  const ctx: CheckoutContext = { paymentId, amount, currency, plan: { id: plan.id, name: plan.name }, user: { email: user.email, name: user.name }, baseUrl };
  const p: Payment = { id: newId(), userId: user.id, email: user.email, plan: plan.id, method: gatewayId, amount, currency, txnId: paymentId, sender: "", status: "pending", note: seats > 1 ? `online checkout started, seats=${seats}` : "online checkout started", createdAt: Date.now(), reviewedAt: null, seats };
  await (await getDB()).createPayment(p);
  const { url } = await g.createCheckout(cfg, ctx);
  return { url, paymentId };
}

/** Called from the gateway return URL and from IPN/webhooks. Safe to call repeatedly. */
export async function completeCheckout(gatewayId: string, paymentId: string, params: Record<string, string>, baseUrl: string): Promise<{ status: "paid" | "failed" | "cancelled" | "pending" | "invalid" | "already"; plan?: string }> {
  const g = gatewayById(gatewayId);
  if (!g) return { status: "invalid" };
  const db = await getDB();
  const payment = (await db.listPayments({ limit: 5000 })).find((p) => p.txnId === paymentId && p.method === gatewayId);
  if (!payment) return { status: "invalid" };
  if (payment.status === "approved") return { status: "already", plan: payment.plan };
  const cfg = await getGatewayConfig(gatewayId);
  const plan = (await getPlans()).find((p) => p.id === payment.plan);
  const ctx: CheckoutContext = { paymentId, amount: payment.amount, currency: payment.currency, plan: { id: payment.plan, name: plan?.name ?? payment.plan }, user: { email: payment.email, name: "" }, baseUrl };
  let v: Awaited<ReturnType<typeof g.verify>>;
  try { v = await g.verify(cfg, params, ctx); } catch (e) { await db.updatePayment(payment.id, { note: `verify error: ${e instanceof Error ? e.message : String(e)}` }); return { status: "pending" }; }
  if (v.ok && v.status === "paid") {
    await db.updatePayment(payment.id, { status: "approved", note: `auto (${gatewayId}${cfg.sandbox ? " sandbox" : ""}) ref ${v.txnId ?? ""}`.trim(), reviewedAt: Date.now() });
    const r = await activatePlan(payment.userId, payment.plan, undefined, payment.seats);
    const site = await getSite();
    if (r) sendEmail(payment.email, `${site.appName}: ${r.plan.name} plan activated`, `Payment ${paymentId} (${g.label}) received. Your ${r.plan.name} plan is active until ${new Date(r.expires).toDateString()}.`).catch(() => {});
    return { status: "paid", plan: payment.plan };
  }
  if (v.status === "cancelled" || v.status === "failed") { await db.updatePayment(payment.id, { status: "rejected", note: `${v.status} (${gatewayId})`, reviewedAt: Date.now() }); return { status: v.status }; }
  await db.updatePayment(payment.id, { note: `verification ${v.status} (${gatewayId})` });
  return { status: v.status };
}
