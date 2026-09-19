/** Public site info: contacts, payment instructions, FAQ, plans (no secrets). */
import { getSite } from "@/lib/saas/site";
import { getPlans, getSessionUser } from "@/lib/saas/service";
import { isStaff } from "@/lib/saas/db";
import { appMode } from "@/lib/saas/mode";
import { enabledGateways } from "@/lib/saas/gateways";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const { promos: _p, ...site } = await getSite(); void _p;
  const user = await getSessionUser(req).catch(() => null);
  return Response.json({ mode: appMode(), site, gateways: await enabledGateways(!!user && isStaff(user.role)), plans: (await getPlans()).map(({ id, name, priceMonthly, priceUSD, currency, monthlyCredits, weeklyCredits, sessionCredits, sessionHours, features, localAI, periodDays, perSeat, minSeats }) => ({ id, name, priceMonthly, priceUSD, currency, monthlyCredits, weeklyCredits, sessionCredits, sessionHours: sessionHours ?? 5, features, localAI, periodDays: periodDays ?? 30, perSeat: !!perSeat, minSeats: minSeats ?? 1 })) });
}
