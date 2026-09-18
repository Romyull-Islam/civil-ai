/** Session + mode info for the UI. Works in every mode (returns mode only when no accounts). */
import { appMode } from "@/lib/saas/mode";
import { getSessionUser, publicUser, quota, getPlans, renewalState, keyStatus } from "@/lib/saas/service";
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
  // Models on higher plans (for the locked section of the model chooser): cheapest plan that offers each one.
  // Only offer models whose provider has an API key (stored by an admin or set in the environment); others would fail.
  const keys = await keyStatus();
  const usable = (m: { provider: string }) => m.provider === "local" || m.provider === "ollama" || !!(keys[m.provider]?.set || keys[m.provider]?.fromEnv);
  const allowedModels = planModels(q.plan).filter(usable);
  const allowedKeys = new Set(planModels(q.plan).map((m) => `${m.provider}/${m.model}`));
  const upgradeModels: { provider: string; model: string; plan: string; planId: string }[] = [];
  for (const p of [...plans].filter((x) => x.priceMonthly > q.plan.priceMonthly).sort((a, b) => a.priceMonthly - b.priceMonthly)) for (const m of planModels(p).filter(usable)) { const k = `${m.provider}/${m.model}`; if (!allowedKeys.has(k)) { allowedKeys.add(k); upgradeModels.push({ ...m, plan: p.name, planId: p.id }); } }
  return Response.json({ mode, user: publicUser(user), avatar: gravatar(user.email), cloud: { limitBytes: cq.limitBytes, usedBytes: cq.used.bytes, maxItems: cq.maxItems, count: cq.used.count }, plan: q.plan, renewal: renewalState(user, subscribed), allowedModels, upgradeModels, usage: { used: q.used, limit: q.limit === Number.MAX_SAFE_INTEGER ? null : q.limit, remaining: q.limit === Number.MAX_SAFE_INTEGER ? null : q.remaining }, plans: plans.map(({ id, name, priceMonthly, currency, dailyRequests, features, perSeat, minSeats }) => ({ id, name, priceMonthly, currency, dailyRequests, features, perSeat: !!perSeat, minSeats: minSeats ?? 1 })), inTeam: !!(await (await import("@/lib/saas/db")).getDB().then((d) => d.getTeamForUser(user.id))) });
}
