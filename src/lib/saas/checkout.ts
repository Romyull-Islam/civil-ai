/** Online checkout orchestration: create a pending payment → send the user to the gateway → verify on return/IPN → activate plan. Idempotent per payment id. */
import { getDB, isStaff, type Payment, type User } from "./db";
import { newId } from "./crypto";
import { getPlans, getCreditPacks, fulfilPayment, sendPaymentConfirmation } from "./service";
import { PACK_PREFIX } from "./plans";
import { isOnlinePayment, ONLINE_GATEWAYS, ONLINE_REF_PREFIX } from "./billing";
import { getSite } from "./site";
import { gatewayById, getGatewayConfig, type CheckoutContext } from "./gateways";

export async function startCheckout(user: User, planId: string, gatewayId: string, baseUrl: string, seatsWanted?: number): Promise<{ url: string; paymentId: string }> {
  const g = gatewayById(gatewayId);
  if (!g) throw new Error("Unknown payment gateway");
  const cfg = await getGatewayConfig(gatewayId);
  if (!cfg.enabled) throw new Error("This payment method is not enabled");
  // Test mode is for staff only: a sandbox payment must never activate a customer's plan.
  if (cfg.sandbox && !isStaff(user.role)) throw new Error("This payment method is not available yet");
  const site = await getSite();
  // What is being bought: a plan period or an extra-credit pack ("credits:<packId>").
  const pack = planId.startsWith(PACK_PREFIX) ? (await getCreditPacks()).find((x) => PACK_PREFIX + x.id === planId) : undefined;
  const plan = pack ? { id: planId, name: pack.name, priceMonthly: pack.price, currency: pack.currency, priceUSD: undefined as number | undefined, perSeat: false, minSeats: 1 } : (await getPlans()).find((p) => p.id === planId);
  if (!plan || plan.priceMonthly <= 0) throw new Error("Choose a paid plan or a credit pack");
  // Stripe charges in USD; Bangladeshi gateways in the local currency.
  const intl = gatewayId === "stripe";
  const seats = plan.perSeat ? Math.max(plan.minSeats ?? 1, Math.floor(seatsWanted ?? 0)) : 1;
  const currency = intl ? "USD" : site.payment.currency;
  const unit = intl ? (plan.priceUSD ?? Math.round((plan.priceMonthly / (site.payment.conversion > 1 ? site.payment.conversion : 122)) * 100) / 100) : Math.round(plan.priceMonthly * (site.payment.currency === plan.currency ? 1 : site.payment.conversion));
  const amount = Math.round(unit * seats * 100) / 100;
  const paymentId = `${ONLINE_REF_PREFIX}${Date.now().toString(36).toUpperCase()}${newId().slice(0, 6).toUpperCase()}`;
  const ctx: CheckoutContext = { paymentId, amount, currency, plan: { id: plan.id, name: plan.name }, user: { email: user.email, name: user.name }, baseUrl };
  const p: Payment = { id: newId(), userId: user.id, email: user.email, plan: plan.id, method: gatewayId, amount, currency, txnId: paymentId, sender: "", status: "pending", note: seats > 1 ? `online checkout started, seats=${seats}` : "online checkout started", createdAt: Date.now(), reviewedAt: null, seats };
  const db = await getDB();
  await db.createPayment(p);
  let session: { url: string; providerRef?: string };
  try { session = await g.createCheckout(cfg, ctx); }
  catch (e) { await db.claimPayment(p.id, "pending", "rejected", { note: `could not start checkout: ${e instanceof Error ? e.message : String(e)}` }); throw e; }
  if (session.providerRef) await db.updatePayment(p.id, { providerRef: session.providerRef });
  return { url: session.url, paymentId };
}

export type CheckoutStatus = "paid" | "failed" | "cancelled" | "pending" | "invalid" | "already";

/**
 * Called from the gateway return URL, IPN/webhooks, the "check status" button and the scheduler. Safe to call repeatedly
 * and concurrently: the payment is moved out of "pending" atomically, so the plan is activated exactly once.
 */
export async function completeCheckout(gatewayId: string, paymentId: string, params: Record<string, string>, baseUrl: string): Promise<{ status: CheckoutStatus; plan?: string }> {
  const g = gatewayById(gatewayId);
  if (!g) return { status: "invalid" };
  const db = await getDB();
  const payment = await db.getPaymentByTxn(paymentId, gatewayId);
  if (!payment || !isOnlinePayment(payment)) return { status: "invalid" };
  if (payment.status === "approved") return { status: "already", plan: payment.plan };
  if (payment.status === "refunded") return { status: "invalid", plan: payment.plan };
  // A checkout marked failed or expired is still verified: if the gateway says the money arrived, the plan is activated.
  const from = payment.status;
  const recheck = params.recheck === "1";
  const cfg = await getGatewayConfig(gatewayId);
  const planName = payment.plan.startsWith(PACK_PREFIX) ? (await getCreditPacks()).find((x) => PACK_PREFIX + x.id === payment.plan)?.name : (await getPlans()).find((p) => p.id === payment.plan)?.name;
  const ctx: CheckoutContext = { paymentId, amount: payment.amount, currency: payment.currency, plan: { id: payment.plan, name: planName ?? payment.plan }, user: { email: payment.email, name: "" }, baseUrl };
  // The gateway's own reference (Stripe session, bKash paymentID, shurjoPay order) lets us verify even without callback parameters.
  const merged = { ...providerParams(gatewayId, payment.providerRef), ...params };
  let v: Awaited<ReturnType<typeof g.verify>>;
  try { v = await g.verify(cfg, merged, ctx); } catch (e) { await db.updatePayment(payment.id, { note: `verify error: ${e instanceof Error ? e.message : String(e)}` }); return { status: "pending" }; }
  if (v.ok && v.status === "paid") {
    if (!(await db.claimPayment(payment.id, from, "approved", { note: `auto (${gatewayId}${cfg.sandbox ? " sandbox" : ""}) ref ${v.txnId ?? ""}`.trim() }))) return { status: "already", plan: payment.plan };
    const r = await fulfilPayment(payment);
    if (r) {
      if (r.carriedDays) await db.claimPayment(payment.id, "approved", "approved", { carriedDays: r.carriedDays });
      await sendPaymentConfirmation({ ...payment, carriedDays: r.carriedDays }, r.label, r.until);
    }
    return { status: "paid", plan: payment.plan };
  }
  if (from !== "pending") return { status: from === "expired" ? "invalid" : "failed", plan: payment.plan };
  // Background re-checks never reject: the customer may still be on the payment page. Unfinished checkouts expire after 24 h.
  if ((v.status === "cancelled" || v.status === "failed") && !recheck) {
    await db.claimPayment(payment.id, "pending", "rejected", { note: `${v.status} (${gatewayId})` });
    return { status: v.status };
  }
  if (!recheck) await db.updatePayment(payment.id, { note: `verification ${v.status} (${gatewayId})` });
  return { status: recheck ? "pending" : v.status };
}

/** Callback parameters each gateway's verify() needs, rebuilt from the stored reference (for re-checks without a callback). */
function providerParams(gatewayId: string, ref?: string): Record<string, string> {
  if (!ref) return {};
  if (gatewayId === "stripe") return { session_id: ref, outcome: "success" };
  if (gatewayId === "bkash") return { paymentID: ref, status: "success" };
  if (gatewayId === "shurjopay") return { order_id: ref, outcome: "success" };
  return { outcome: "success" };
}

/** Re-check a pending online payment with its gateway (the customer closed the tab, or the IPN never arrived). */
export async function recheckPayment(payment: Payment, baseUrl: string) {
  if (!["pending", "expired", "rejected"].includes(payment.status) || !isOnlinePayment(payment)) return { status: payment.status === "approved" ? ("already" as const) : ("invalid" as const) };
  return completeCheckout(payment.method, payment.txnId, { recheck: "1" }, baseUrl);
}

/** Scheduler: re-check recent pending online checkouts, then expire the ones older than 24 hours. */
export async function sweepPendingPayments(baseUrl: string): Promise<{ rechecked: number; expired: number }> {
  const db = await getDB();
  // Only our own online checkouts: manual transfers wait for staff however long it takes.
  const pending = (await db.listPayments({ status: "pending", limit: 200 })).filter(isOnlinePayment);
  let rechecked = 0;
  for (const p of pending) if (Date.now() - p.createdAt > 5 * 60000) { await recheckPayment(p, baseUrl).catch(() => {}); rechecked++; }
  const expired = await db.expirePendingPayments(ONLINE_GATEWAYS, Date.now() - 24 * 3600000);
  return { rechecked, expired };
}
