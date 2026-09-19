import { getSessionUser, resendVerification } from "@/lib/saas/service";
export const runtime = "nodejs";
const last = new Map<string, number>();
export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (Date.now() - (last.get(user.id) ?? 0) < 60000) return Response.json({ error: "Please wait a minute before requesting another code" }, { status: 429 });
  last.set(user.id, Date.now());
  try { await resendVerification(user); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  return Response.json({ ok: true });
}
