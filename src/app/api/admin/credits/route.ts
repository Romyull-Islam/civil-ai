/** Give a customer extra AI credits (goodwill, a failed payment sorted out by hand, a promotion). */
import { guardArea } from "@/lib/saas/admin";
import { getDB } from "@/lib/saas/db";
import { grantCredits } from "@/lib/saas/service";
import { audit } from "@/lib/saas/security";
export const runtime = "nodejs";
export const POST = guardArea("payments", async (req, actor) => {
  const { email, credits, days, note } = (await req.json()) as { email: string; credits: number; days?: number; note?: string };
  const user = email ? await (await getDB()).getUserByEmail(email) : null;
  if (!user) return Response.json({ error: "No account with that email" }, { status: 404 });
  const n = Number(credits);
  if (!(n > 0 && n <= 100000)) return Response.json({ error: "Credits must be between 1 and 100000" }, { status: 400 });
  await grantCredits(user.id, n, Math.max(1, Math.min(365, Number(days) || 90)), null, (note || "Given by support").slice(0, 80));
  await audit(actor.id, "credits.grant", user.email, `${n} credits`);
  return Response.json({ ok: true });
});
