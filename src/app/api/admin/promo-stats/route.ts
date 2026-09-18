import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { getSite } from "@/lib/saas/site";
export const runtime = "nodejs";
export const GET = guardArea("site", async () => {
  const db = await getDB();
  const out: Record<string, { views: number; clicks: number }> = {};
  for (const p of (await getSite()).promos) out[p.id] = JSON.parse((await db.getSetting(`promo-stat:${p.id}`)) || '{"views":0,"clicks":0}');
  return Response.json({ stats: out });
});
