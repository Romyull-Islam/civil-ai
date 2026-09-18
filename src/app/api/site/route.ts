/** Public site info: contacts, payment instructions, FAQ, plans (no secrets). */
import { getSite } from "@/lib/saas/site";
import { getPlans } from "@/lib/saas/service";
import { appMode } from "@/lib/saas/mode";
import { enabledGateways } from "@/lib/saas/gateways";
export const runtime = "nodejs";
export async function GET() {
  const site = await getSite();
  return Response.json({ mode: appMode(), site, gateways: await enabledGateways(), plans: (await getPlans()).map(({ id, name, priceMonthly, priceUSD, currency, dailyRequests, features, localAI, periodDays, perSeat, minSeats }) => ({ id, name, priceMonthly, priceUSD, currency, dailyRequests, features, localAI, periodDays: periodDays ?? 30, perSeat: !!perSeat, minSeats: minSeats ?? 1 })) });
}
