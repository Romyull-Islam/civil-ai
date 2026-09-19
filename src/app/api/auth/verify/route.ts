/** Confirm the emailed code: by email + code (before any sign-in) or for the signed-in user. Success signs the user in. */
import { getSessionUser, verifyEmail, verifyEmailAndSignIn, sessionCookie, publicUser } from "@/lib/saas/service";
import { rateLimit, clientIp } from "@/lib/saas/security";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const { code, email } = ((await req.json().catch(() => ({}))) ?? {}) as { code?: string; email?: string };
  if (!rateLimit(`verify-ip:${clientIp(req)}`, 30, 30 * 60000)) return Response.json({ error: "Too many attempts, try again later" }, { status: 429 });
  const session = await getSessionUser(req);
  if (session) {
    if (!rateLimit(`verify:${session.id}`, 8, 30 * 60000)) return Response.json({ error: "Too many attempts, request a new code" }, { status: 429 });
    return (await verifyEmail(session, String(code ?? ""))) ? Response.json({ ok: true }) : Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return Response.json({ error: "Enter your email address" }, { status: 400 });
  if (!rateLimit(`verify:${e}`, 8, 30 * 60000)) return Response.json({ error: "Too many attempts, request a new code" }, { status: 429 });
  const r = await verifyEmailAndSignIn(e, String(code ?? ""));
  if (!r) return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  return new Response(JSON.stringify({ ok: true, user: publicUser(r.user) }), { headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(r.token) } });
}
