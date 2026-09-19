/** Session + mode info for the UI. Works in every mode (returns mode only when no accounts). */
import { appMode, hasAccounts } from "@/lib/saas/mode";
import { licenseState } from "@/lib/company/license";
import { getDB } from "@/lib/saas/db";
import { needsVerification, getSessionUser, publicUser, quota, publicUsage, getPlans, renewalState, keyStatus } from "@/lib/saas/service";
import { startRenewalScheduler } from "@/lib/saas/renewals";
import { gravatar, quotaFor } from "@/lib/saas/saves";
import { planModels } from "@/lib/saas/plans";
import { isUsable } from "@/lib/ai/quality";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const mode = appMode();
  if (!hasAccounts(mode)) return Response.json({ mode, user: null });
  const user = await getSessionUser(req);
  const company = mode === "company";
  // Company edition: first run (no accounts yet) → the login page offers to create the owner account.
  if (company && !user) return Response.json({ mode, user: null, setupNeeded: (await (await getDB()).countUsers()) === 0 });
  const plans = await getPlans();
  if (!user) return Response.json({ mode, user: null, plans: plans.map(({ id, name, priceMonthly, currency, monthlyCredits, weeklyCredits, sessionCredits, sessionHours, features }) => ({ id, name, priceMonthly, currency, monthlyCredits, weeklyCredits, sessionCredits, sessionHours: sessionHours ?? 5, features })) });
  startRenewalScheduler();
  const q = await quota(user);
  const subscribed = plans.find((p) => p.id === user.plan) ?? q.plan; // renewal state refers to the plan the user paid for, even after it lapsed to Free
  const cq = await quotaFor(user);
  // Models on higher plans (for the locked section of the model chooser): cheapest plan that offers each one.
  // Only offer models whose provider has an API key (stored by an admin or set in the environment); others would fail.
  const keys = await keyStatus();
  const usable = (m: { provider: string; model: string }) => isUsable(m.provider, m.model) && (m.provider === "local" || m.provider === "ollama" || !!(keys[m.provider]?.set || keys[m.provider]?.fromEnv));
  const allowedModels = planModels(q.plan).filter(usable);
  const allowedKeys = new Set(planModels(q.plan).map((m) => `${m.provider}/${m.model}`));
  const upgradeModels: { provider: string; model: string; plan: string; planId: string }[] = [];
  for (const p of [...plans].filter((x) => x.priceMonthly > q.plan.priceMonthly).sort((a, b) => a.priceMonthly - b.priceMonthly)) for (const m of planModels(p).filter(usable)) { const k = `${m.provider}/${m.model}`; if (!allowedKeys.has(k)) { allowedKeys.add(k); upgradeModels.push({ ...m, plan: p.name, planId: p.id }); } }
  return Response.json({ mode, user: publicUser(user), mustVerify: await needsVerification(user), avatar: company ? undefined : gravatar(user.email), license: company ? await licenseState().then((l) => ({ status: l.status, message: l.message, company: l.company, seats: l.seats, expires: l.expires, chatAllowed: l.chatAllowed })) : undefined, cloud: { limitBytes: cq.limitBytes, usedBytes: cq.used.bytes, maxItems: cq.maxItems, count: cq.used.count }, plan: q.plan, renewal: renewalState(user, subscribed), allowedModels, upgradeModels, usage: publicUsage(q), plans: plans.map(({ id, name, priceMonthly, currency, monthlyCredits, weeklyCredits, sessionCredits, sessionHours, features, perSeat, minSeats }) => ({ id, name, priceMonthly, currency, monthlyCredits, weeklyCredits, sessionCredits, sessionHours: sessionHours ?? 5, features, perSeat: !!perSeat, minSeats: minSeats ?? 1 })), inTeam: !!(await (await import("@/lib/saas/db")).getDB().then((d) => d.getTeamForUser(user.id))) });
}
