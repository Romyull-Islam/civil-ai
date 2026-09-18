import { appMode } from "@/lib/saas/mode";
import { login, sessionCookie, publicUser } from "@/lib/saas/service";
import { rateLimit, clientIp, isLocked, loginFailed, loginSucceeded } from "@/lib/saas/security";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (appMode() !== "saas") return Response.json({ error: "Accounts are only used in SaaS mode" }, { status: 400 });
  if (!rateLimit(`login:${clientIp(req)}`, 30, 15 * 60000)) return Response.json({ error: "Too many attempts, try again later" }, { status: 429 });
  const { email, password, totp } = (await req.json()) as { email: string; password: string; totp?: string };
  const e = String(email ?? "").toLowerCase();
  if (await isLocked(e)) return Response.json({ error: "Account temporarily locked after repeated failures. Try again in 15 minutes or reset your password." }, { status: 423 });
  try {
    const { user, token, needsTotp } = await login(e, password, totp);
    if (needsTotp) return Response.json({ needsTotp: true }, { status: 202 });
    await loginSucceeded(e);
    return new Response(JSON.stringify({ user: publicUser(user), token }), { headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(token) } });
  } catch (err) {
    const lock = await loginFailed(e);
    return Response.json({ error: lock.locked ? "Too many failed attempts, account locked for 15 minutes" : (err instanceof Error ? err.message : String(err)) }, { status: lock.locked ? 423 : 401 });
  }
}
