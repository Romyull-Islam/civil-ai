/** Send a new verification code: for the signed-in user, or by email address before sign-in (always the same reply). */
import { getSessionUser, resendVerification, resendVerificationByEmail } from "@/lib/saas/service";
import { rateLimit, clientIp } from "@/lib/saas/security";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!rateLimit(`resend-ip:${clientIp(req)}`, 10, 3600000)) return Response.json({ error: "Too many requests, try again later" }, { status: 429 });
  const user = await getSessionUser(req);
  const { email } = ((await req.json().catch(() => ({}))) ?? {}) as { email?: string };
  const key = user?.id ?? String(email ?? "").trim().toLowerCase();
  if (!key) return Response.json({ error: "Enter your email address" }, { status: 400 });
  if (!rateLimit(`resend:${key}`, 1, 60000)) return Response.json({ error: "Please wait a minute before requesting another code" }, { status: 429 });
  try { if (user) await resendVerification(user); else await resendVerificationByEmail(String(email)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  return Response.json({ ok: true, message: "If this address has an unverified account, a new code is on its way." });
}
