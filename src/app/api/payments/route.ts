import { getSessionUser, submitPayment } from "@/lib/saas/service";
import { getDB } from "@/lib/saas/db";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  return Response.json({ payments: await (await getDB()).listPayments({ userId: user.id, limit: 50 }) });
}
export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  try { const p = await submitPayment(user, await req.json()); return Response.json({ payment: p }, { status: 201 }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
