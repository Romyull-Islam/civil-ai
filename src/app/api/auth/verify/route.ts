import { getSessionUser, verifyEmail } from "@/lib/saas/service";
import { rateLimit } from "@/lib/saas/security";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!rateLimit(`verify:${user.id}`, 8, 30 * 60000)) return Response.json({ error: "Too many attempts — request a new code" }, { status: 429 });
  const { code } = (await req.json()) as { code: string };
  const ok = await verifyEmail(user, String(code ?? ""));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Invalid or expired code" }, { status: 400 });
}
