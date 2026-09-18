import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
export const runtime = "nodejs";
export const GET = guardArea("usage", async (req) => {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const db = await getDB();
  return Response.json({ byDay: await db.usageByDay(days), byUser: await db.usageByUser(days), users: await db.countUsers() });
});
