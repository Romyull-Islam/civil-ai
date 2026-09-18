/** Session + mode info for the UI. Works in every mode (returns mode only when no accounts). */
import { appMode } from "@/lib/saas/mode";
import { getSessionUser, publicUser, quota, getPlans, renewalState } from "@/lib/saas/service";
import { startRenewalScheduler } from "@/lib/saas/renewals";
import { gravatar, quotaFor } from "@/lib/saas/saves";
import { planModels } from "@/lib/saas/plans";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const mode = appMode();
  if (mode !== "saas") return Response.json({ mode, user: null });
  const user = await getSessionUser(req);
  const plans = await getPlans();
  if (!user) return Response.json({ mode, user: null, plans: plans.map(({ id, name, priceMonthly, currency, dailyRequests, features }) => ({ id, name, priceMonthly, currency, dailyRequests, features })) });
  startRenewalScheduler();
  const q = await quota(user);
  const subscribed = plans.find((p) => p.id === user.plan) ?? q.plan; // renewal state refers to the plan the user paid for, even after it lapsed to Free
  const cq = await quotaFor(user);
  return Response.json({ mode, user: publicUser(user), avatar: gravatar(user.email), cloud: { limitBytes: cq.limitBytes, usedBytes: cq.used.bytes, maxItems: cq.maxItems, count: cq.used.count }, plan: q.plan, renewal: renewalState(user, subscribed), allowedModels: planModels(q.plan), usage: { used: q.used, limit: q.limit === Number.MAX_SAFE_INTEGER ? null : q.limit, remaining: q.limit === Number.MAX_SAFE_INTEGER ? null : q.remaining }, plans: plans.map(({ id, name, priceMonthly, currency, dailyRequests, features, perSeat, minSeats }) => ({ id, name, priceMonthly, currency, dailyRequests, features, perSeat: !!perSeat, minSeats: minSeats ?? 1 })), inTeam: !!(await (await import("@/lib/saas/db")).getDB().then((d) => d.getTeamForUser(user.id))) });
}
