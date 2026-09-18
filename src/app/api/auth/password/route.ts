import { getSessionUser, changePassword } from "@/lib/saas/service";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  try { const { current, next } = (await req.json()) as { current: string; next: string }; await changePassword(user, current, next); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
