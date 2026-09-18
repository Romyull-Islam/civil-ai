import { guardArea } from "@/lib/saas/admin";
import { getPlans, setPlans } from "@/lib/saas/service";
import { DEFAULT_PLANS, type Plan } from "@/lib/saas/plans";
export const runtime = "nodejs";
export const GET = guardArea("plans", async () => Response.json({ plans: await getPlans(), defaults: DEFAULT_PLANS }));
export const POST = guardArea("plans", async (req) => {
  const { plans } = (await req.json()) as { plans: Plan[] };
  if (!Array.isArray(plans) || !plans.length || !plans.every((p) => p.id && p.name && Array.isArray(p.providers))) return Response.json({ error: "Invalid plans" }, { status: 400 });
  await setPlans(plans);
  return Response.json({ plans: await getPlans() });
});
