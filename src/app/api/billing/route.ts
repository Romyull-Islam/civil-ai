/** Everything the Billing page needs for the signed-in user: plan, usage, extra credits, history and plan-change quotes. */
import { getSessionUser, getPlans, getCreditPacks, planFor, quota, publicUsage, renewalState, carryOverDays } from "@/lib/saas/service";
import { enabledGateways } from "@/lib/saas/gateways";
import { getDB, isStaff } from "@/lib/saas/db";
import { getSite } from "@/lib/saas/site";
import { purchaseLabel, methodLabel, isOnlinePayment } from "@/lib/saas/billing";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const db = await getDB();
  const [plans, packs, current, q, gateways, site, payments, grants] = await Promise.all([getPlans(), getCreditPacks(), planFor(user), quota(user), enabledGateways(isStaff(user.role)), getSite(), db.listPayments({ userId: user.id, limit: 100 }), db.listCreditGrants(user.id, Date.now())]);
  const subscribed = plans.find((p) => p.id === user.plan) ?? current;
  const quotes = Object.fromEntries(plans.filter((p) => p.priceMonthly > 0).map((p) => [p.id, carryOverDays({ plan: subscribed, expires: user.planExpires }, p)]));
  return Response.json({
    plan: { id: current.id, name: current.name, priceMonthly: current.priceMonthly, currency: current.currency, periodDays: current.periodDays ?? 30, monthlyCredits: current.monthlyCredits, weeklyCredits: current.weeklyCredits, sessionCredits: current.sessionCredits, sessionHours: current.sessionHours ?? 5, features: current.features },
    expires: user.planExpires, renewal: renewalState(user, subscribed), usage: publicUsage(q),
    plans: plans.map(({ id, name, priceMonthly, currency, periodDays, monthlyCredits, weeklyCredits, sessionCredits, perSeat, features }) => ({ id, name, priceMonthly, currency, periodDays: periodDays ?? 30, monthlyCredits, weeklyCredits, sessionCredits, perSeat: !!perSeat, features })),
    packs, quotes, gateways, currency: site.payment.currency,
    grants: grants.map((g) => ({ credits: g.credits, remaining: Math.round(g.remaining * 10) / 10, expiresAt: g.expiresAt, note: g.note })),
    payments: payments.map((p) => ({ id: p.id, createdAt: p.createdAt, what: purchaseLabel(p, plans, packs), method: methodLabel(p.method, p.txnId), online: isOnlinePayment(p), amount: p.amount, currency: p.currency, ref: p.txnId, status: p.status, carriedDays: p.carriedDays ?? 0 })),
  });
}
